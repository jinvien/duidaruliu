import { contentText, resolveTranscriptTools } from '@earendil-works/pi-ai';
// 包根的 d.ts 把这个类标成了 type-only，值从公开的 utils 入口取，避免碰到 providers/api/compat。
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

import type { OllamaModelParams } from '../hooks/useOllama';
import { streamingFetch } from '../utils/streamFetch';
import {
  OLLAMA_TOOL_IMAGE_NOTE,
  toOllamaWireMessage,
  type OllamaFunctionCall,
  type OllamaWireImage,
  type OllamaWireMessage,
} from '../utils/ollamaMessage';

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
  ToolCall,
} from '@earendil-works/pi-ai';

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const LANG_FULLNAME: Record<string, string> = {
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
  /** 只有模型明确具备 tools 能力时才为 true。 */
  includeTools?: boolean;
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
  /** 最后一个片段带的 token 统计。 */
  prompt_eval_count?: unknown;
  eval_count?: unknown;
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

function countField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
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
    // 工具声明会插入空 system，不能把它写进 Ollama 消息。
    if (!text) return null;
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
    const calls = message.content.filter((part): part is ToolCall => part.type === 'toolCall');
    const thinking = message.content
      .filter((part) => part.type === 'thinking')
      .map((part) => part.thinking)
      .join('');
    const wire: OllamaWireMessage = {
      role: 'assistant',
      content: contentText(message.content, ''),
    };
    if (thinking) wire.thinking = thinking;
    if (calls.length) {
      wire.tool_calls = calls.map(
        (call): OllamaFunctionCall => ({
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })
      );
    }
    return wire;
  }

  if (message.role === 'toolResult') {
    const content = message.content
      .map((part) => (part.type === 'image' ? OLLAMA_TOOL_IMAGE_NOTE : part.text))
      .filter((part) => part.length > 0)
      .join('\n');
    return { role: 'tool', tool_name: message.toolName, content };
  }

  return null;
}

function buildChatBody(messages: readonly Message[], request: OllamaStreamRequest): string {
  const activeSystem = { text: '' };
  const wire = messages.flatMap((message) => {
    const next = wireMessage(message, request, activeSystem);
    return next ? [next] : [];
  });

  const requestTools = resolveTranscriptTools(messages, 'none').requestTools;
  const body: Record<string, unknown> = {
    messages: wire,
    ...request.modelParams,
  };
  if (request.includeTools && requestTools.length > 0) {
    body.tools = requestTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  return JSON.stringify(body);
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
  message: string,
  content: AssistantMessage['content']
): AssistantMessage {
  return {
    role: 'assistant',
    content,
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
  const trackedCalls: {
    contentIndex: number;
    id: string;
    name: string;
    argumentsText: string;
    arguments?: Record<string, unknown>;
    closed: boolean;
  }[] = [];

  const finish = (event: Parameters<AssistantMessageEventStream['push']>[0]) => {
    if (finished) return;
    finished = true;
    stream.push(event);
  };

  const fail = (error: unknown) => {
    const aborted = isAbortError(error) || options?.signal?.aborted === true;
    // 停止和请求失败不能丢掉已经流出的正文、思考。未完成的工具调用不记入这条消息。
    const kept: AssistantMessage['content'] = [];
    for (const part of partial.content) {
      if (part.type === 'text') kept.push({ type: 'text', text: part.text });
      else if (part.type === 'thinking') kept.push({ type: 'thinking', thinking: part.thinking });
    }
    finish({
      type: 'error',
      reason: aborted ? 'aborted' : 'error',
      error: failureMessage(
        model,
        aborted ? 'aborted' : 'error',
        errorText(error),
        kept.length ? kept : [{ type: 'text', text: '' }]
      ),
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

  const closeToolCall = (call: (typeof trackedCalls)[number]) => {
    if (call.closed) return;
    let args: Record<string, unknown> = {};
    if (call.arguments) args = call.arguments;
    else if (call.argumentsText) {
      try {
        const parsed = JSON.parse(call.argumentsText) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    }
    const toolCall: ToolCall = {
      type: 'toolCall',
      id: call.id,
      name: call.name,
      arguments: args as ToolCall['arguments'],
    };
    partial.content[call.contentIndex] = toolCall;
    stream.push({ type: 'toolcall_end', contentIndex: call.contentIndex, toolCall, partial });
    call.closed = true;
  };

  const applyToolCalls = (raw: unknown) => {
    if (!Array.isArray(raw) || !raw.length) return;
    sawToolCall = true;
    raw.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const entry = item as {
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      let call = trackedCalls[index];
      const name = typeof entry.function?.name === 'string' ? entry.function.name : '';
      if (!call) {
        const id = typeof entry.id === 'string' && entry.id ? entry.id : `ollama-tool-${index + 1}`;
        partial.content.push({ type: 'toolCall', id, name, arguments: {} });
        call = {
          contentIndex: partial.content.length - 1,
          id,
          name,
          argumentsText: '',
          closed: false,
        };
        trackedCalls[index] = call;
        stream.push({ type: 'toolcall_start', contentIndex: call.contentIndex, partial });
      } else if (name && !call.name) {
        call.name = name;
        (partial.content[call.contentIndex] as ToolCall).name = name;
      }
      const args = entry.function?.arguments;
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        call.arguments = args as Record<string, unknown>;
        closeToolCall(call);
        return;
      }
      if (typeof args === 'string' && args) {
        call.argumentsText += args;
        stream.push({
          type: 'toolcall_delta',
          contentIndex: call.contentIndex,
          delta: args,
          partial,
        });
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
    applyToolCalls(message?.tool_calls);

    if (chunk.done === true) {
      closeBlocks();
      trackedCalls.forEach(closeToolCall);
      const reason = stopReason(chunk.done_reason);
      partial.stopReason = reason;
      const input = countField(chunk.prompt_eval_count);
      const output = countField(chunk.eval_count);
      if (input !== undefined || output !== undefined) {
        partial.usage = {
          input: input ?? 0,
          output: output ?? 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: (input ?? 0) + (output ?? 0),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
      }
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
            trackedCalls.forEach(closeToolCall);
            const reason = stopReason(undefined);
            partial.stopReason = reason;
            finish({ type: 'done', reason, message: partial });
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
