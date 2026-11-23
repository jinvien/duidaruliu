import {
  systemText,
  type CustomStreamRequest,
  type NeutralMessage,
  type NeutralTool,
} from './neutral';
import { obj, parseEventData, str, type ChunkSink, type FinishReason } from './core';

import type { SseEvent } from '../../utils/sseFetch';

type Block = Record<string, unknown>;
type WireMessage = { role: 'user' | 'assistant'; content: Block[] };

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_TOKENS_WITH_THINKING = 16384;
const MIN_THINKING_BUDGET = 1024;

function append(list: WireMessage[], role: WireMessage['role'], blocks: Block[]) {
  if (!blocks.length) return;
  const last = list[list.length - 1];
  // Messages 协议要求角色交替，连续同角色的内容合并成一条。
  if (last?.role === role) last.content.push(...blocks);
  else list.push({ role, content: [...blocks] });
}

function wireMessages(messages: readonly NeutralMessage[], request: CustomStreamRequest) {
  const list: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const blocks: Block[] = [];
      if (message.text) blocks.push({ type: 'text', text: message.text });
      for (const image of message.images) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mimeType, data: image.data },
        });
      }
      append(list, 'user', blocks);
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: Block[] = [];
      // 没有签名的思考块会被官方接口拒绝。拿不到签名就不回填。
      if (request.model.thinking && message.thinking && message.thinkingSignature) {
        blocks.push({
          type: 'thinking',
          thinking: message.thinking,
          signature: message.thinkingSignature,
        });
      }
      if (message.text) blocks.push({ type: 'text', text: message.text });
      for (const call of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
        });
      }
      append(list, 'assistant', blocks);
      continue;
    }

    append(list, 'user', [
      {
        type: 'tool_result',
        tool_use_id: message.callId,
        content: message.text,
        ...(message.isError ? { is_error: true } : {}),
      },
    ]);
  }
  return list;
}

export function buildMessagesBody(
  messages: readonly NeutralMessage[],
  tools: readonly NeutralTool[],
  request: CustomStreamRequest
): Record<string, unknown> {
  const { model } = request;
  const maxTokens =
    model.maxOutputTokens ??
    (model.thinking ? DEFAULT_MAX_TOKENS_WITH_THINKING : DEFAULT_MAX_TOKENS);
  const body: Record<string, unknown> = {
    model: model.model,
    // Messages 协议必须带 max_tokens，没配输出上限时给一个保守的默认值。
    max_tokens: maxTokens,
    messages: wireMessages(messages, request),
    stream: true,
  };
  const system = systemText(messages);
  if (system) body.system = system;

  // budget_tokens 必须小于 max_tokens，且不小于 1024。放不下就不开思考。
  const thinkingOn = model.thinking && maxTokens > MIN_THINKING_BUDGET;
  if (thinkingOn) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(
        Math.max(MIN_THINKING_BUDGET, Math.floor(maxTokens / 2)),
        maxTokens - 1
      ),
    };
  } else if (request.temperature !== undefined) {
    // 开启思考时接口只接受默认温度。
    body.temperature = request.temperature;
  }

  if (tools.length) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  return body;
}

function stopReason(value: unknown): FinishReason {
  if (value === 'max_tokens') return 'length';
  if (value === 'tool_use') return 'toolUse';
  return 'stop';
}

export function handleMessagesEvent(event: SseEvent, sink: ChunkSink): void {
  const data = parseEventData(event);
  if (!data) return;
  const type = str(data.type) || event.event;
  const key = `b${typeof data.index === 'number' ? data.index : 0}`;

  switch (type) {
    case 'content_block_start': {
      const block = obj(data.content_block);
      if (block?.type === 'tool_use') {
        sink.toolStart(key, { id: str(block.id), name: str(block.name) });
        // 个别实现会在起始块里直接给完整 input。非空对象才有意义。
        const input = obj(block.input);
        if (input && Object.keys(input).length) sink.toolArgsFull(key, input);
      } else if (block?.type === 'thinking') {
        const text = str(block.thinking);
        if (text) sink.thinking(text);
      } else if (block?.type === 'text') {
        const text = str(block.text);
        if (text) sink.text(text);
      }
      return;
    }
    case 'content_block_delta': {
      const delta = obj(data.delta);
      if (!delta) return;
      if (delta.type === 'text_delta') {
        const text = str(delta.text);
        if (text) sink.text(text);
      } else if (delta.type === 'thinking_delta') {
        const text = str(delta.thinking);
        if (text) sink.thinking(text);
      } else if (delta.type === 'signature_delta') {
        const signature = str(delta.signature);
        if (signature) sink.thinkingSignature(signature);
      } else if (delta.type === 'input_json_delta') {
        const partial = str(delta.partial_json);
        if (partial) sink.toolArgsDelta(key, partial);
      }
      return;
    }
    case 'content_block_stop':
      sink.toolEnd(key);
      return;
    case 'message_delta': {
      const reason = obj(data.delta)?.stop_reason;
      if (reason) sink.stopReason(stopReason(reason));
      return;
    }
    case 'message_stop':
      sink.finish();
      return;
    case 'error': {
      const message = str(obj(data.error)?.message)?.trim() || str(data.message)?.trim();
      sink.fail(new Error(message || 'stream error'));
      return;
    }
    default:
  }
}
