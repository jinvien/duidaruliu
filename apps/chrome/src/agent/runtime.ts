import { Agent } from '@earendil-works/pi-agent-core';
import i18n from '@/i18n';
import store from '@/store';
import {
  addMessage,
  patchLastAssistant,
  setPendingTool,
  setResponseStatus,
  updateLastMessage,
} from '@/store/chatSlice';
import { imageDataUrlToBase64 } from '@/utils/chatImage';
import { modelHasTools, modelHasVision } from '@/utils/modelCapability';
import {
  clearSessionToolAllows,
  isToolAllowedForSession,
  requestToolApproval,
} from '@/mcp/approval';
import { listCallableMcpTools, setMcpToolsChangedListener } from '@/mcp/session';
import { buildAgentTools, toolRejectedReason } from '@/mcp/tools';

import { foldAssistantText, streamOllamaChat, type OllamaStreamRequest } from './ollamaStream';

import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ImageContent, TextContent, ToolCall } from '@earendil-works/pi-ai';
import type { OllamaModelParams } from '@/hooks/useOllama';
import type { Message } from '@/store/chatSlice';

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DATA_URL_MIME = /^data:([^;,]+)/i;

let reportChatError: (error: unknown) => void = () => {};
let modelParamsOverride: OllamaModelParams | undefined;
let loadingTimer: ReturnType<typeof setTimeout> | undefined;
let thinkingText = '';
let visibleText = '';
/** 每次换会话或重新开跑都会增加。过期的流式事件不能再改界面。 */
let epoch = 0;
/** 当前这次 continue 对应的 epoch。0 表示还没有跑过。 */
let runEpoch = 0;

function mimeTypeFromDataUrl(dataUrl: string): string {
  return DATA_URL_MIME.exec(dataUrl)?.[1] || 'image/png';
}

function toAgentMessages(messages: Message[]): AgentMessage[] {
  return messages.map((message): AgentMessage => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content, timestamp: message.createdAt };
    }

    if (message.role === 'user') {
      const images: ImageContent[] = (message.images ?? []).map((image) => ({
        type: 'image',
        data: imageDataUrlToBase64(image.dataUrl),
        mimeType: mimeTypeFromDataUrl(image.dataUrl),
      }));
      if (!images.length) {
        return { role: 'user', content: message.content, timestamp: message.createdAt };
      }
      const content: Array<TextContent | ImageContent> = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      content.push(...images);
      return { role: 'user', content, timestamp: message.createdAt };
    }

    if (message.role === 'tool') {
      return {
        role: 'toolResult',
        toolCallId: message.toolCallId || '',
        toolName: message.toolName || '',
        content: [{ type: 'text', text: message.content }],
        isError: message.isError === true,
        timestamp: message.createdAt,
      };
    }

    const content: AssistantMessage['content'] = [];
    if (message.thinking) content.push({ type: 'thinking', thinking: message.thinking });
    if (message.content) content.push({ type: 'text', text: message.content });
    for (const call of message.toolCalls ?? []) {
      content.push({
        type: 'toolCall',
        id: call.id,
        name: call.name,
        arguments: call.arguments as ToolCall['arguments'],
      });
    }
    if (!content.length) content.push({ type: 'text', text: '' });
    return {
      role: 'assistant',
      content,
      api: 'ollama',
      provider: 'ollama',
      model: message.model ?? '',
      usage: EMPTY_USAGE,
      stopReason: message.toolCalls?.length ? 'toolUse' : 'stop',
      timestamp: message.createdAt,
    };
  });
}

function currentRequest(): OllamaStreamRequest {
  const { ollamaUrl, ollamaModelParams, listedModels } = store.getState().ollama;
  const modelParams = modelParamsOverride ?? ollamaModelParams;
  return {
    url: `${ollamaUrl}/api/chat`,
    modelParams,
    includeImages: modelHasVision(listedModels, modelParams.model),
    includeTools:
      store.getState().mcp.toolsEnabled && modelHasTools(listedModels, modelParams.model),
    lang: store.getState().app.lang,
    translateSystemPrompt: i18n.t('prompt.aiTranslateSelected.systemPrompt'),
    translatePostfix: i18n.t('prompt.aiTranslateSelected.postfix'),
  };
}

function clearLoadingTimer() {
  if (loadingTimer === undefined) return;
  clearTimeout(loadingTimer);
  loadingTimer = undefined;
}

function runIsCurrent() {
  return runEpoch !== 0 && runEpoch === epoch;
}

function invalidateRun() {
  epoch += 1;
  clearLoadingTimer();
}

function armRun() {
  epoch += 1;
  runEpoch = epoch;
}

function messageText(message: AgentMessage): string {
  if (!('content' in message)) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') return part.thinking;
      return '';
    })
    .join('');
}

function lastAssistant(
  messages: AgentMessage[]
): Extract<AgentMessage, { role: 'assistant' }> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

// 整个侧栏共用一个 Agent。ChatSender 和 ChatContent 都会调用 useChat，不能各建一个循环。
const agent = new Agent({
  initialState: {
    thinkingLevel: 'off',
    tools: [],
    messages: [],
  },
  toolExecution: 'sequential',
  streamFn: (model, context, options) =>
    streamOllamaChat(model, context, options, currentRequest()),
  beforeToolCall: async ({ toolCall, args }, signal) => {
    if (signal?.aborted || isToolAllowedForSession(toolCall.name)) return undefined;
    const meta = toolLabels.get(toolCall.name);
    const decision = await requestToolApproval(
      {
        id: toolCall.name,
        displayName: meta?.displayName || toolCall.name,
        serverName: meta?.serverName || '',
        args,
      },
      signal ?? new AbortController().signal
    );
    if (decision === 'aborted' || signal?.aborted) return undefined;
    if (decision === 'once' || decision === 'session') return undefined;
    return { block: true, reason: toolRejectedReason() };
  },
});

const toolLabels = new Map<string, { displayName: string; serverName: string }>();

export function refreshAgentTools() {
  const state = store.getState();
  const expose =
    state.mcp.toolsEnabled &&
    modelHasTools(state.ollama.listedModels, state.ollama.ollamaModelParams.model);
  if (!expose) {
    toolLabels.clear();
    agent.state.tools = [];
    return;
  }
  const built = buildAgentTools(listCallableMcpTools());
  toolLabels.clear();
  const callable = listCallableMcpTools().slice(0, built.length);
  built.forEach((tool, index) => {
    const source = callable[index];
    if (!source) return;
    toolLabels.set(tool.name, {
      displayName: source.title || source.name,
      serverName: source.serverName,
    });
  });
  agent.state.tools = built as AgentTool[];
}

setMcpToolsChangedListener(() => refreshAgentTools());

agent.subscribe((event) => {
  if (!runIsCurrent()) return;

  if (event.type === 'agent_start') {
    thinkingText = '';
    visibleText = '';
    clearLoadingTimer();
    const scheduledEpoch = epoch;
    loadingTimer = setTimeout(() => {
      loadingTimer = undefined;
      if (scheduledEpoch !== epoch) return;
      store.dispatch(setResponseStatus('waiting'));
    }, 500);
    return;
  }

  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent;
    if (update.type !== 'text_delta' && update.type !== 'thinking_delta') return;
    const last = store.getState().chat.messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    if (update.type === 'text_delta') visibleText += update.delta;
    else thinkingText += update.delta;
    clearLoadingTimer();
    store.dispatch(setResponseStatus('outputting'));
    store.dispatch(updateLastMessage(foldAssistantText(thinkingText, visibleText)));
    return;
  }

  if (event.type === 'message_end' && event.message.role === 'assistant') {
    const thinking = event.message.content
      .filter((part) => part.type === 'thinking')
      .map((part) => part.thinking)
      .join('');
    const toolCalls = event.message.content
      .filter((part): part is ToolCall => part.type === 'toolCall')
      .map((part) => ({ id: part.id, name: part.name, arguments: part.arguments }));
    store.dispatch(patchLastAssistant({ ...(thinking ? { thinking } : {}), toolCalls }));
    return;
  }

  if (event.type === 'tool_execution_start') {
    clearLoadingTimer();
    store.dispatch(setResponseStatus('tool'));
    store.dispatch(
      setPendingTool({
        id: event.toolCallId,
        name: event.toolName,
        argumentsText: JSON.stringify(event.args ?? {}),
      })
    );
    return;
  }

  if (event.type === 'message_end' && event.message.role === 'toolResult') {
    const content = event.message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter((text) => text.length > 0)
      .join('\n');
    store.dispatch(setPendingTool(null));
    store.dispatch(
      addMessage({
        role: 'tool',
        content,
        createdAt: event.message.timestamp || Date.now(),
        toolCallId: event.message.toolCallId,
        toolName: event.message.toolName,
        isError: event.message.isError,
      })
    );
    return;
  }

  if (event.type !== 'agent_end') return;
  clearLoadingTimer();
  store.dispatch(setResponseStatus('end'));
  const assistant = lastAssistant(event.messages);
  if (!assistant || assistant.stopReason === 'stop' || assistant.stopReason === 'length') return;
  if (assistant.stopReason === 'toolUse') return;
  const error = new Error(assistant.errorMessage ?? '');
  if (assistant.stopReason === 'aborted') {
    error.name = 'AbortError';
  }
  console.error('onChatError', error);
  reportChatError(error);
});

export function setChatErrorReporter(reporter: (error: unknown) => void) {
  reportChatError = reporter;
}

export function agentIsStreaming(): boolean {
  return agent.state.isStreaming;
}

export function abortAgent() {
  agent.abort();
}

/**
 * 立刻让进行中的增量失效，再中止循环并等到它真正停下来。
 * 换会话之前调用，避免旧回复写到新的消息列表上。
 */
export async function settleAgent() {
  invalidateRun();
  if (agent.state.isStreaming) {
    agent.abort();
    await agent.waitForIdle();
  }
  store.dispatch(setResponseStatus('end'));
}

/** 新对话：运行中不重置。调用方要先确认已经空闲，再清空界面。 */
export function resetAgentTranscript(): boolean {
  if (agent.state.isStreaming) return false;
  clearSessionToolAllows();
  agent.reset();
  agent.state.messages = [];
  refreshAgentTools();
  return true;
}

/** 打开历史只回填转录，不调用 prompt。运行中不改共享 Agent。 */
export function loadAgentTranscript(messages: Message[]): boolean {
  if (agent.state.isStreaming) return false;
  clearSessionToolAllows();
  agent.state.messages = toAgentMessages(messages);
  return true;
}

export function snapshotAgentTranscript(): { role: string; text: string }[] {
  return agent.state.messages.map((message) => ({
    role: message.role,
    text: messageText(message),
  }));
}

export async function continueAgent(messages: Message[], override?: OllamaModelParams) {
  if (agent.state.isStreaming) await settleAgent();
  armRun();
  modelParamsOverride = override;
  agent.state.messages = toAgentMessages(messages);
  try {
    await agent.continue();
  } finally {
    modelParamsOverride = undefined;
  }
}

/** 停掉上一轮后再按当前 Redux 消息请求。调用方即使已经换过会话，也不能在这里直接返回。 */
export async function startAssistantTurn(override?: OllamaModelParams) {
  await settleAgent();
  const state = store.getState();
  const messages = state.chat.messages;
  store.dispatch(
    addMessage({
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: state.ollama.ollamaModelParams.model,
    })
  );
  try {
    await continueAgent(messages, override);
  } catch (error) {
    console.error('onChatError', error);
    store.dispatch(setResponseStatus('end'));
    reportChatError(error);
  }
}
