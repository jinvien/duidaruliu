import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

import type {
  Api,
  AssistantMessage,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';
import type { SseEvent } from '../../utils/sseFetch';

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export type FinishReason = Extract<StopReason, 'stop' | 'length' | 'toolUse'>;

/** 协议适配器往里喂的增量。核心负责拼成 pi 的事件流。 */
export type ChunkSink = {
  text(delta: string): void;
  thinking(delta: string): void;
  thinkingSignature(signature: string): void;
  /** key 只要在一次响应内能区分不同的工具调用即可。重复调用只补全缺的字段。 */
  toolStart(key: string, init: { id?: string; name?: string }): void;
  toolArgsDelta(key: string, delta: string): void;
  /** 已经拿到完整参数，字符串按 JSON 解析。 */
  toolArgsFull(key: string, args: unknown): void;
  toolEnd(key: string): void;
  stopReason(reason: FinishReason): void;
  finish(): void;
  fail(error: unknown): void;
};

export type ProtocolHandler = (event: SseEvent, sink: ChunkSink) => void;

type TrackedCall = {
  contentIndex: number;
  id: string;
  name: string;
  argumentsText: string;
  arguments?: Record<string, unknown>;
  closed: boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createStreamCore(
  piModel: Model<Api>,
  displayModel: string,
  signal: AbortSignal | undefined
): { stream: AssistantMessageEventStream; sink: ChunkSink } {
  const stream = new AssistantMessageEventStream();
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: piModel.api,
    provider: piModel.provider,
    // 消息上记录用户配置的模型名，历史和气泡标题都读这个。
    model: displayModel,
    usage: EMPTY_USAGE,
    stopReason: 'pending',
    timestamp: Date.now(),
  };

  let finished = false;
  let started = false;
  let textIndex = -1;
  let thinkingIndex = -1;
  let reason: FinishReason = 'stop';
  const calls = new Map<string, TrackedCall>();
  let callSeq = 0;

  const push = (event: Parameters<AssistantMessageEventStream['push']>[0]) => {
    if (finished) return;
    stream.push(event);
  };

  const ensureStarted = () => {
    if (started) return;
    started = true;
    push({ type: 'start', partial });
  };

  const ensureBlock = (kind: 'text' | 'thinking') => {
    ensureStarted();
    if (kind === 'text') {
      if (textIndex >= 0) return textIndex;
      partial.content.push({ type: 'text', text: '' });
      textIndex = partial.content.length - 1;
      push({ type: 'text_start', contentIndex: textIndex, partial });
      return textIndex;
    }
    if (thinkingIndex >= 0) return thinkingIndex;
    partial.content.push({ type: 'thinking', thinking: '' });
    thinkingIndex = partial.content.length - 1;
    push({ type: 'thinking_start', contentIndex: thinkingIndex, partial });
    return thinkingIndex;
  };

  const closeToolCall = (call: TrackedCall) => {
    if (call.closed) return;
    let args: Record<string, unknown> = {};
    if (call.arguments) args = call.arguments;
    else if (call.argumentsText.trim()) {
      try {
        args = asObject(JSON.parse(call.argumentsText)) ?? {};
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
    call.closed = true;
    push({ type: 'toolcall_end', contentIndex: call.contentIndex, toolCall, partial });
  };

  const closeBlocks = () => {
    partial.content.forEach((block, index) => {
      if (block.type === 'thinking') {
        push({ type: 'thinking_end', contentIndex: index, content: block.thinking, partial });
      } else if (block.type === 'text') {
        push({ type: 'text_end', contentIndex: index, content: block.text, partial });
      }
    });
    calls.forEach(closeToolCall);
  };

  const sink: ChunkSink = {
    text(delta) {
      if (finished || !delta) return;
      const index = ensureBlock('text');
      (partial.content[index] as TextContent).text += delta;
      push({ type: 'text_delta', contentIndex: index, delta, partial });
    },

    thinking(delta) {
      if (finished || !delta) return;
      const index = ensureBlock('thinking');
      (partial.content[index] as ThinkingContent).thinking += delta;
      push({ type: 'thinking_delta', contentIndex: index, delta, partial });
    },

    thinkingSignature(signature) {
      if (finished || !signature) return;
      const index = ensureBlock('thinking');
      const block = partial.content[index] as ThinkingContent;
      block.thinkingSignature = (block.thinkingSignature ?? '') + signature;
    },

    toolStart(key, init) {
      if (finished) return;
      ensureStarted();
      let call = calls.get(key);
      if (!call) {
        callSeq += 1;
        const id = init.id || `custom-tool-${callSeq}`;
        const name = init.name ?? '';
        partial.content.push({ type: 'toolCall', id, name, arguments: {} });
        call = {
          contentIndex: partial.content.length - 1,
          id,
          name,
          argumentsText: '',
          closed: false,
        };
        calls.set(key, call);
        push({ type: 'toolcall_start', contentIndex: call.contentIndex, partial });
        return;
      }
      const block = partial.content[call.contentIndex] as ToolCall;
      if (init.name && !call.name) {
        call.name = init.name;
        block.name = init.name;
      }
      // 有的网关首包不带 id，后面才补。
      if (init.id && call.id.startsWith('custom-tool-')) {
        call.id = init.id;
        block.id = init.id;
      }
    },

    toolArgsDelta(key, delta) {
      const call = calls.get(key);
      if (finished || !call || call.closed || !delta) return;
      call.argumentsText += delta;
      push({ type: 'toolcall_delta', contentIndex: call.contentIndex, delta, partial });
    },

    toolArgsFull(key, args) {
      const call = calls.get(key);
      if (finished || !call || call.closed) return;
      const object = asObject(args);
      if (object) {
        call.arguments = object;
        return;
      }
      if (typeof args === 'string' && args) {
        // 完整参数覆盖之前累积的增量，避免 delta 后又收到 done 时重复拼接。
        call.argumentsText = args;
      }
    },

    toolEnd(key) {
      const call = calls.get(key);
      if (call) closeToolCall(call);
    },

    stopReason(next) {
      reason = next;
    },

    finish() {
      if (finished) return;
      ensureStarted();
      closeBlocks();
      const final: FinishReason = calls.size > 0 ? 'toolUse' : reason;
      partial.stopReason = final;
      finished = true;
      stream.push({ type: 'done', reason: final, message: partial });
    },

    fail(error) {
      if (finished) return;
      const aborted = isAbortError(error) || signal?.aborted === true;
      // 停止和请求失败不能丢掉已经流出的正文、思考。未完成的工具调用不记入这条消息。
      const kept: AssistantMessage['content'] = [];
      for (const part of partial.content) {
        if (part.type === 'text') kept.push({ type: 'text', text: part.text });
        else if (part.type === 'thinking') {
          kept.push({
            type: 'thinking',
            thinking: part.thinking,
            ...(part.thinkingSignature ? { thinkingSignature: part.thinkingSignature } : {}),
          });
        }
      }
      finished = true;
      const message: AssistantMessage = {
        role: 'assistant',
        content: kept.length ? kept : [{ type: 'text', text: '' }],
        api: piModel.api,
        provider: piModel.provider,
        model: displayModel,
        usage: EMPTY_USAGE,
        stopReason: aborted ? 'aborted' : 'error',
        errorMessage: errorText(error),
        timestamp: Date.now(),
      };
      stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message });
    },
  };

  return { stream, sink };
}

/** 事件的 data 部分按 JSON 解析。失败返回 undefined，调用方忽略该事件。 */
export function parseEventData(event: SseEvent): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(event.data));
  } catch {
    return undefined;
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function obj(value: unknown): Record<string, unknown> | undefined {
  return asObject(value);
}
