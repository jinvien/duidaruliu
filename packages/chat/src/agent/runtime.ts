import { Agent } from '@earendil-works/pi-agent-core';
import i18n from '../i18n';
import store from '../store';
import {
  addMessage,
  patchLastAssistant,
  setPendingTool,
  setResponseStatus,
  updateLastMessage,
} from '../store/chatSlice';
import { imageDataUrlToBase64 } from '../utils/chatImage';
import { formatPageForModel } from '../page/format';
import { shouldExposeTools } from '../mcp/toolGate';
import { modelHasTools, modelHasVision } from '../utils/modelCapability';
import {
  cancelPendingToolApproval,
  clearSessionToolAllows,
  decideToolApproval,
  getPendingToolApproval,
  isToolAllowedForSession,
  requestToolApproval,
} from '../mcp/approval';

export { decideToolApproval, getPendingToolApproval, isToolAllowedForSession };
import { listCallableMcpTools, setMcpToolsChangedListener } from '../mcp/session';
import { blockReasonForToolDecision, buildAgentTools } from '../mcp/tools';

import { streamOllamaChat, type OllamaStreamRequest } from './ollamaStream';
import { streamCustomChat, type CustomStreamRequest } from './customStream';
import {
  findActiveCustomModel,
  selectCombinedModels,
  selectSelectedModelKey,
  selectSelectedModelLabel,
} from '../models/selection';

import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ImageContent, TextContent, ToolCall } from '@earendil-works/pi-ai';
import type { OllamaModelParams } from '../hooks/useOllama';
import type { CustomModel } from '../models/customModel';
import type { Message } from '../store/chatSlice';

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
/** 同一个对话的多次提问共用，随新对话或打开历史更换。自定义模型用它做会话亲和。 */
let sessionId = newTrackingId();
/** 一次提问（含工具循环里的多轮模型调用）共用，每次 continue 更换。 */
let qaId = newTrackingId();
let modelParamsOverride: OllamaModelParams | undefined;
let loadingTimer: ReturnType<typeof setTimeout> | undefined;
let thinkingText = '';
let visibleText = '';
/** 每次换会话或重新开跑都会增加。过期的流式事件不能再改界面。 */
let epoch = 0;
/** 当前这次 continue 对应的 epoch。0 表示还没有跑过。 */
let runEpoch = 0;

function newTrackingId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  return DATA_URL_MIME.exec(dataUrl)?.[1] || 'image/png';
}

function toAgentMessages(messages: Message[]): AgentMessage[] {
  return messages.map((message): AgentMessage => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content, timestamp: message.createdAt };
    }

    if (message.role === 'user') {
      // 页面引用在这里拼进文本，Ollama 和自定义模型都从这里取消息。
      const text = message.page ? formatPageForModel(message.page, message.content) : message.content;
      const images: ImageContent[] = (message.images ?? []).map((image) => ({
        type: 'image',
        data: imageDataUrlToBase64(image.dataUrl),
        mimeType: mimeTypeFromDataUrl(image.dataUrl),
      }));
      if (!images.length) {
        return { role: 'user', content: text, timestamp: message.createdAt };
      }
      const content: Array<TextContent | ImageContent> = [];
      if (text) content.push({ type: 'text', text });
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
    includeTools: shouldExposeTools(
      store.getState().mcp.toolsEnabled,
      modelHasTools(listedModels, modelParams.model)
    ),
    lang: store.getState().app.lang,
    translateSystemPrompt: i18n.t('prompt.aiTranslateSelected.systemPrompt'),
    translatePostfix: i18n.t('prompt.aiTranslateSelected.postfix'),
  };
}

function currentCustomRequest(custom: CustomModel): CustomStreamRequest {
  const state = store.getState();
  return {
    model: custom,
    includeImages: custom.vision,
    includeTools: shouldExposeTools(state.mcp.toolsEnabled, custom.tools),
    lang: state.app.lang,
    translateSystemPrompt: i18n.t('prompt.aiTranslateSelected.systemPrompt'),
    translatePostfix: i18n.t('prompt.aiTranslateSelected.postfix'),
    // 翻译场景会带一个低温度覆盖，其余场景不传，交给服务端默认值。
    temperature: modelParamsOverride?.options?.temperature,
    thinkingEnabled: !state.customModel.thinkingOff.includes(custom.id),
    tracking: { sessionId, qaId },
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
  streamFn: (model, context, options) => {
    const custom = findActiveCustomModel(store.getState());
    if (custom) return streamCustomChat(model, context, options, currentCustomRequest(custom));
    return streamOllamaChat(model, context, options, currentRequest());
  },
  beforeToolCall: async ({ toolCall, args }, signal) => {
    if (signal?.aborted) {
      return { block: true, reason: blockReasonForToolDecision('aborted', true) ?? '' };
    }
    if (isToolAllowedForSession(toolCall.name)) return undefined;
    const decision = await requestToolApproval(
      {
        id: toolCall.name,
        displayName: toolDisplayName(toolCall.name),
        serverName: toolLabels.get(toolCall.name)?.serverName || '',
        args,
      },
      signal ?? new AbortController().signal
    );
    const reason = blockReasonForToolDecision(
      decision === 'once' || decision === 'session' ? undefined : decision,
      signal?.aborted === true
    );
    if (reason) return { block: true, reason };
    return undefined;
  },
});

const toolLabels = new Map<string, { displayName: string; serverName: string }>();

function toolDisplayName(name: string) {
  return (
    toolLabels.get(name)?.displayName ||
    agent.state.tools.find((tool) => tool.name === name)?.label ||
    name
  );
}

/** 工具结果之后的下一轮助手消息要新开一条，不能写回工具调用那条。 */
function ensureStreamingAssistant(model?: string) {
  const last = store.getState().chat.messages.at(-1);
  if (last?.role === 'assistant') return;
  thinkingText = '';
  visibleText = '';
  store.dispatch(
    addMessage({
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: model && model !== 'unknown' ? model : selectSelectedModelLabel(store.getState()),
    })
  );
}

function assistantParts(message: Extract<AgentMessage, { role: 'assistant' }>) {
  const text = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const thinking = message.content
    .filter((part) => part.type === 'thinking')
    .map((part) => part.thinking)
    .join('');
  const toolCalls = message.content
    .filter((part): part is ToolCall => part.type === 'toolCall')
    .map((part) => ({ id: part.id, name: part.name, arguments: part.arguments }));
  return { text, thinking, toolCalls };
}

export function refreshAgentTools() {
  const state = store.getState();
  const expose = shouldExposeTools(
    state.mcp.toolsEnabled,
    modelHasTools(selectCombinedModels(state), selectSelectedModelKey(state))
  );
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

export function setAgentTools(tools: AgentTool[]) {
  agent.state.tools = tools;
}

setMcpToolsChangedListener(() => refreshAgentTools());

agent.subscribe((event) => {
  try {
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

  if (event.type === 'message_start' && event.message.role === 'assistant') {
    const message = event.message;
    thinkingText = '';
    visibleText = '';
    ensureStreamingAssistant(message.model);
    return;
  }

  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent;
    const message = event.message;
    if (update.type !== 'text_delta' && update.type !== 'thinking_delta') return;
    if (message.role !== 'assistant') return;
    ensureStreamingAssistant(message.model);
    if (update.type === 'text_delta') visibleText += update.delta;
    else thinkingText += update.delta;
    clearLoadingTimer();
    store.dispatch(setResponseStatus('outputting'));
    store.dispatch(updateLastMessage(visibleText));
    if (thinkingText) store.dispatch(patchLastAssistant({ thinking: thinkingText }));
    return;
  }

  if (event.type === 'message_end' && event.message.role === 'assistant') {
    const message = event.message;
    ensureStreamingAssistant(message.model);
    const { text, thinking, toolCalls } = assistantParts(message);
    // 停止或失败的收尾消息可能没有正文。空串不能盖掉已经流出来的 partial。
    // 换会话时 run 已经失效，这里也不会把这次取消写进下一通。
    const failed = message.stopReason === 'aborted' || message.stopReason === 'error';
    if (!(failed && text.length === 0)) store.dispatch(updateLastMessage(text));
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
        displayName: toolDisplayName(event.toolName),
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
        toolDisplayName: toolDisplayName(event.message.toolName),
        isError: event.message.isError,
      })
    );
    return;
  }

  if (event.type !== 'agent_end') return;
  clearLoadingTimer();
  cancelPendingToolApproval();
  store.dispatch(setPendingTool(null));
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
  } finally {
    // 每个流式片段都通知的话，输入框和顶栏会跟着整棵重渲染。
    // 那里的受控列表会在 layout 里再次 setState，和气泡列表的更新叠在同一次同步渲染里，
    // 嵌套次数超过 React 的上限后，这个异常会被收成对话失败。
    // isStreaming 只在开跑和收尾变化，按钮只需要这两次。
    if (event.type === 'agent_start') queueMicrotask(publishAgentActivity);
    // agent_end 之后还要经过好几层 await 才会 finishRun 清掉 isStreaming，一个微任务等不到。
    // 通知得太早，界面最后一次渲染就停在「仍在流式」，依赖它的按钮（如添加图片）会一直灰着。
    // waitForIdle 在 finishRun 里 resolve，此时 isStreaming 已经是 false。
    if (event.type === 'agent_end') void agent.waitForIdle().then(publishAgentActivity);
  }
});

export function setChatErrorReporter(reporter: (error: unknown) => void) {
  reportChatError = reporter;
}

let activityVersion = 0;
const activityListeners = new Set<() => void>();

function publishAgentActivity() {
  activityVersion += 1;
  for (const listener of activityListeners) listener();
}

/** 循环在 agent_end 监听返回之后才把 isStreaming 清掉。晚一拍再通知界面。 */
export function subscribeAgentActivity(listener: () => void) {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function getAgentActivity() {
  return activityVersion;
}

export function agentIsStreaming(): boolean {
  return agent.state.isStreaming;
}

export function abortAgent() {
  store.dispatch(setPendingTool(null));
  agent.abort();
  cancelPendingToolApproval();
}

/**
 * 立刻让进行中的增量失效，再中止循环并等到它真正停下来。
 * 换会话之前调用，避免旧回复写到新的消息列表上。
 */
export async function settleAgent() {
  invalidateRun();
  store.dispatch(setPendingTool(null));
  if (agent.state.isStreaming) {
    agent.abort();
    cancelPendingToolApproval();
    await agent.waitForIdle();
  } else {
    cancelPendingToolApproval();
  }
  store.dispatch(setResponseStatus('end'));
  store.dispatch(setPendingTool(null));
}

/** 新对话：运行中不重置。调用方要先确认已经空闲，再清空界面。 */
export function resetAgentTranscript(): boolean {
  if (agent.state.isStreaming) return false;
  clearSessionToolAllows();
  sessionId = newTrackingId();
  agent.reset();
  agent.state.messages = [];
  refreshAgentTools();
  return true;
}

/** 打开历史只回填转录，不调用 prompt。运行中不改共享 Agent。 */
export function loadAgentTranscript(messages: Message[]): boolean {
  if (agent.state.isStreaming) return false;
  clearSessionToolAllows();
  sessionId = newTrackingId();
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
  qaId = newTrackingId();
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
  store.dispatch(setResponseStatus('waiting'));
  const state = store.getState();
  const messages = state.chat.messages;
  store.dispatch(
    addMessage({
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: selectSelectedModelLabel(state),
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
