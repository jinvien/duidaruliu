import { contentText, resolveTranscriptTools } from '@earendil-works/pi-ai';
// 包根的 d.ts 把这个类标成了 type-only，值从公开的 utils 入口取，避免碰到 providers/api/compat。
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

import type { OllamaModelParams } from '@/hooks/useOllama';
import { streamingFetch } from '@/utils/streamFetch';
import {
  toOllamaWireMessage,
  type OllamaWireImage,
  type OllamaWireMessage,
} from '@/utils/ollamaMessage';

import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  TextContent,
  ThinkingContent,
} from '@earendil-works/pi-ai';

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const LANG_FULLNAME: Record<string, string> = {
  zh: '中文',
  'zh-CN': '中文',
  en: 'English',
};

export type OllamaStreamRequest = {
  url: string;
  modelParams: OllamaModelParams;
  includeImages: boolean;
  lang: string;
  translateSystemPrompt: string;
  translatePostfix: string;
  fetchImpl?: typeof fetch;
};

type OllamaChunk = {
  message?: {
    role?: string;
    content?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
  };
  done?: boolean;
  done_reason?: unknown;
  error?: unknown;
};

/**
 * 思考字段折进现有 `<think>` 渲染。正文里已经有 think 标签时只保留这一处，避免两段思考叠在一起。
 */
export function foldAssistantText(thinking: string, content: string): string {
  if (!thinking) return content;
  if (content.includes('<think>')) return content;
  return `<think>${thinking}</think>${content}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asChunk(value: unknown): OllamaChunk | null {
  if (!value || typeof value !== 'object') return null;
  return value as OllamaChunk;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function chunkHasToolCall(chunk: OllamaChunk): boolean {
  const calls = chunk.message?.tool_calls;
  return Array.isArray(calls) && calls.length > 0;
}

function userImages(message: Message): OllamaWireImage[] {
  if (message.role !== 'user' || typeof message.content === 'string') return [];
  return message.content
    .filter((part): part is ImageContent => part.type === 'image')
    .map((part) => ({ data: part.data }));
}

function wireMessage(
  message: Message,
  request: OllamaStreamRequest,
  activeSystem: { text: string }
): OllamaWireMessage | null {
  if (message.role === 'system') {
    const text = contentText(message.content, '');
    activeSystem.text = text;
    return { role: 'system', content: text };
  }

  if (message.role === 'user') {
    let text = contentText(message.content, '');
    if (activeSystem.text && activeSystem.text === request.translateSystemPrompt) {
      text = `${text} \n ${request.translatePostfix}${LANG_FULLNAME[request.lang]}`;
    }
    return toOllamaWireMessage(
      { role: 'user', content: text, images: userImages(message) },
      request.includeImages
    );
  }

  if (message.role === 'assistant') {
    return { role: 'assistant', content: contentText(message.content, '') };
  }

  if (message.role === 'toolResult') {
    return { role: 'tool', content: contentText(message.content, '') };
  }

  return null;
}

function buildChatBody(messages: readonly Message[], request: OllamaStreamRequest): string {
  const activeSystem = { text: '' };
  const wire = messages.flatMap((message) => {
    const next = wireMessage(message, request, activeSystem);
    return next ? [next] : [];
  });

  // "none" 把声明折进 requestTools。阶段一这份列表是空的，请求体因此没有 tools，也不带 think。
  const toolNames = resolveTranscriptTools(messages, 'none').requestTools.map((tool) => tool.name);
  if (toolNames.length > 0) {
    console.warn(`ollama /api/chat omitted tools: ${toolNames.join(', ')}`);
  }

  return JSON.stringify({
    messages: wire,
    ...request.modelParams,
  });
}

function createPartial(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

function failureMessage(
  model: Model<Api>,
  reason: Extract<StopReason, 'aborted' | 'error'>,
  message: string
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: reason,
    errorMessage: message,
    timestamp: Date.now(),
  };
}

/**
 * 立刻返回事件流，请求和 NDJSON 解析在流内部完成。失败写入 error 事件，不向外抛。
 */
export function streamOllamaChat(
  model: Model<Api>,
  context: { messages: readonly Message[] },
  options: SimpleStreamOptions | undefined,
  request: OllamaStreamRequest
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const partial = createPartial(model);
  let finished = false;
  let started = false;
  let textIndex = -1;
  let thinkingIndex = -1;
  let sawToolCall = false;

  const finish = (event: Parameters<AssistantMessageEventStream['push']>[0]) => {
    if (finished) return;
    finished = true;
    stream.push(event);
  };

  const fail = (error: unknown) => {
    const aborted = isAbortError(error) || options?.signal?.aborted === true;
    finish({
      type: 'error',
      reason: aborted ? 'aborted' : 'error',
      error: failureMessage(model, aborted ? 'aborted' : 'error', errorText(error)),
    });
  };

  const ensureBlock = (kind: 'text' | 'thinking') => {
    if (kind === 'text') {
      if (textIndex >= 0) return textIndex;
      partial.content.push({ type: 'text', text: '' });
      textIndex = partial.content.length - 1;
      stream.push({ type: 'text_start', contentIndex: textIndex, partial });
      return textIndex;
    }
    if (thinkingIndex >= 0) return thinkingIndex;
    partial.content.push({ type: 'thinking', thinking: '' });
    thinkingIndex = partial.content.length - 1;
    stream.push({ type: 'thinking_start', contentIndex: thinkingIndex, partial });
    return thinkingIndex;
  };

  const appendText = (delta: string) => {
    const index = ensureBlock('text');
    const block = partial.content[index] as TextContent;
    block.text += delta;
    stream.push({ type: 'text_delta', contentIndex: index, delta, partial });
  };

  const appendThinking = (delta: string) => {
    const index = ensureBlock('thinking');
    const block = partial.content[index] as ThinkingContent;
    block.thinking += delta;
    stream.push({ type: 'thinking_delta', contentIndex: index, delta, partial });
  };

  const closeBlocks = () => {
    partial.content.forEach((block, index) => {
      if (block.type === 'thinking') {
        stream.push({
          type: 'thinking_end',
          contentIndex: index,
          content: block.thinking,
          partial,
        });
      } else if (block.type === 'text') {
        stream.push({ type: 'text_end', contentIndex: index, content: block.text, partial });
      }
    });
  };

  const stopReason = (doneReason: unknown): Extract<StopReason, 'stop' | 'length' | 'toolUse'> => {
    if (sawToolCall) return 'toolUse';
    return doneReason === 'length' ? 'length' : 'stop';
  };

  const consumeChunk = (value: unknown) => {
    if (finished) return;
    const chunk = asChunk(value);
    if (!chunk) return;

    const error = stringField(chunk.error)?.trim();
    if (error && !chunk.message) {
      fail(new Error(error));
      return;
    }

    if (!started) {
      started = true;
      stream.push({ type: 'start', partial });
    }

    const message = chunk.message;
    const thinking = stringField(message?.thinking);
    const content = stringField(message?.content);
    // 空 content 也要继续看同一片段上的 tool_calls，不能像旧实现那样直接 return。
    if (thinking) appendThinking(thinking);
    if (content) appendText(content);
    if (chunkHasToolCall(chunk)) sawToolCall = true;

    if (chunk.done === true) {
      closeBlocks();
      const reason = stopReason(chunk.done_reason);
      partial.stopReason = reason;
      finish({ type: 'done', reason, message: partial });
    }
  };

  void (async () => {
    try {
      await streamingFetch(
        {
          url: request.url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildChatBody(context.messages, request),
          signal: options?.signal,
          fetchImpl: request.fetchImpl,
        },
        {
          onUpdate: consumeChunk,
          onSuccess: () => {
            if (finished) return;
            if (!started) {
              started = true;
              stream.push({ type: 'start', partial });
            }
            closeBlocks();
            partial.stopReason = 'stop';
            finish({ type: 'done', reason: 'stop', message: partial });
          },
          onError: fail,
        }
      );
    } catch (error) {
      fail(error);
    }
  })();

  return stream;
}
