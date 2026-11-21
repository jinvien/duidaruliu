import { Agent } from '@earendil-works/pi-agent-core';
import i18n from '@/i18n';
import store from '@/store';
import { setResponseStatus, updateLastMessage } from '@/store/chatSlice';
import { imageDataUrlToBase64 } from '@/utils/chatImage';
import { modelHasVision } from '@/utils/modelCapability';

import { foldAssistantText, streamOllamaChat, type OllamaStreamRequest } from './ollamaStream';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ImageContent, TextContent } from '@earendil-works/pi-ai';
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
        toolCallId: '',
        toolName: '',
        content: [{ type: 'text', text: message.content }],
        isError: false,
        timestamp: message.createdAt,
      };
    }

    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
      api: 'ollama',
      provider: 'ollama',
      model: message.model ?? '',
      usage: EMPTY_USAGE,
      stopReason: 'stop',
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
});

agent.subscribe((event) => {
  if (event.type === 'agent_start') {
    thinkingText = '';
    visibleText = '';
    clearLoadingTimer();
    loadingTimer = setTimeout(() => {
      store.dispatch(setResponseStatus('waiting'));
    }, 500);
    return;
  }

  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent;
    if (update.type !== 'text_delta' && update.type !== 'thinking_delta') return;
    if (update.type === 'text_delta') visibleText += update.delta;
    else thinkingText += update.delta;
    clearLoadingTimer();
    store.dispatch(setResponseStatus('outputting'));
    store.dispatch(updateLastMessage(foldAssistantText(thinkingText, visibleText)));
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

/** 新对话：先重置循环，再由调用方清空界面消息。不保留上一轮的系统提示。 */
export function resetAgentTranscript() {
  if (agent.state.isStreaming) return;
  agent.reset();
  agent.state.messages = [];
}

/** 打开历史只回填转录，不调用 prompt。 */
export function loadAgentTranscript(messages: Message[]) {
  agent.state.messages = toAgentMessages(messages);
}

export async function continueAgent(messages: Message[], override?: OllamaModelParams) {
  if (agent.state.isStreaming) return;
  modelParamsOverride = override;
  agent.state.messages = toAgentMessages(messages);
  try {
    await agent.continue();
  } finally {
    modelParamsOverride = undefined;
  }
}
