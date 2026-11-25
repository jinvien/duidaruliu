import {
  dataUrl,
  systemText,
  type CustomStreamRequest,
  type NeutralMessage,
  type NeutralTool,
} from './neutral';
import { obj, parseEventData, str, type ChunkSink } from './core';

import type { SseEvent } from '../../utils/sseFetch';

function inputItems(messages: readonly NeutralMessage[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const message of messages) {
    // system 统一进 instructions。
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      items.push({
        role: 'user',
        content: [
          ...(message.text || !message.images.length
            ? [{ type: 'input_text', text: message.text }]
            : []),
          ...message.images.map((image) => ({ type: 'input_image', image_url: dataUrl(image) })),
        ],
      });
      continue;
    }

    if (message.role === 'assistant') {
      if (message.text) {
        items.push({ role: 'assistant', content: [{ type: 'output_text', text: message.text }] });
      }
      for (const call of message.toolCalls) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        });
      }
      continue;
    }

    items.push({ type: 'function_call_output', call_id: message.callId, output: message.text });
  }
  return items;
}

export function buildResponsesBody(
  messages: readonly NeutralMessage[],
  tools: readonly NeutralTool[],
  request: CustomStreamRequest
): Record<string, unknown> {
  const { model } = request;
  const body: Record<string, unknown> = {
    model: model.model,
    input: inputItems(messages),
    stream: true,
  };
  const instructions = systemText(messages);
  if (instructions) body.instructions = instructions;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (model.maxOutputTokens) body.max_output_tokens = model.maxOutputTokens;
  if (model.thinking) body.reasoning = { effort: 'high' };
  if (model.sessionHeaders && request.tracking) body.prompt_cache_key = request.tracking.sessionId;
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
  return body;
}

function callKey(data: Record<string, unknown>, item?: Record<string, unknown>): string {
  if (typeof data.output_index === 'number') return `o${data.output_index}`;
  return `id${str(data.item_id) ?? str(item?.id) ?? ''}`;
}

function failureMessage(data: Record<string, unknown>): string {
  const response = obj(data.response);
  const error = obj(response?.error) ?? obj(data.error);
  return (
    str(error?.message)?.trim() ||
    str(data.message)?.trim() ||
    str(response?.status) ||
    'response failed'
  );
}

export function handleResponsesEvent(event: SseEvent, sink: ChunkSink): void {
  if (event.data.trim() === '[DONE]') {
    sink.finish();
    return;
  }
  const data = parseEventData(event);
  if (!data) return;
  const type = str(data.type) || event.event;

  switch (type) {
    case 'response.output_text.delta': {
      const delta = str(data.delta);
      if (delta) sink.text(delta);
      return;
    }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const delta = str(data.delta);
      if (delta) sink.thinking(delta);
      return;
    }
    case 'response.output_item.added': {
      const item = obj(data.item);
      if (item?.type !== 'function_call') return;
      const key = callKey(data, item);
      sink.toolStart(key, { id: str(item.call_id) || str(item.id), name: str(item.name) });
      const args = str(item.arguments);
      if (args) sink.toolArgsDelta(key, args);
      return;
    }
    case 'response.function_call_arguments.delta': {
      const delta = str(data.delta);
      if (delta) sink.toolArgsDelta(callKey(data), delta);
      return;
    }
    case 'response.function_call_arguments.done': {
      const key = callKey(data);
      sink.toolArgsFull(key, data.arguments);
      return;
    }
    case 'response.output_item.done': {
      const item = obj(data.item);
      if (item?.type !== 'function_call') return;
      const key = callKey(data, item);
      // 个别实现不发 added，直接在 done 里给完整调用。
      sink.toolStart(key, { id: str(item.call_id) || str(item.id), name: str(item.name) });
      sink.toolArgsFull(key, item.arguments);
      sink.toolEnd(key);
      return;
    }
    case 'response.incomplete': {
      const reason = str(obj(obj(data.response)?.incomplete_details)?.reason);
      sink.stopReason(reason === 'max_output_tokens' ? 'length' : 'stop');
      sink.finish();
      return;
    }
    case 'response.completed':
      sink.stopReason('stop');
      sink.finish();
      return;
    case 'response.failed':
    case 'error':
      sink.fail(new Error(failureMessage(data)));
      return;
    default:
  }
}
