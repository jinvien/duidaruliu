import {
  dataUrl,
  type CustomStreamRequest,
  type NeutralMessage,
  type NeutralTool,
} from './neutral';
import { obj, parseEventData, str, type ChunkSink, type FinishReason } from './core';

import type { SseEvent } from '../../utils/sseFetch';

function isOfficialOpenAi(url: string): boolean {
  try {
    return new URL(url).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function wireMessage(message: NeutralMessage, request: CustomStreamRequest) {
  if (message.role === 'system') return { role: 'system', content: message.text };

  if (message.role === 'user') {
    if (!message.images.length) return { role: 'user', content: message.text };
    return {
      role: 'user',
      content: [
        ...(message.text ? [{ type: 'text', text: message.text }] : []),
        ...message.images.map((image) => ({
          type: 'image_url',
          image_url: { url: dataUrl(image) },
        })),
      ],
    };
  }

  if (message.role === 'assistant') {
    const wire: Record<string, unknown> = {
      role: 'assistant',
      // 只有工具调用时，部分网关要求 content 为 null 而不是空串。
      content: message.text || (message.toolCalls.length ? null : ''),
    };
    // 慢思考下的工具调用需要每一轮回填历史 reasoning_content。只对声明了思考的模型回填。
    if (request.model.thinking && message.thinking) wire.reasoning_content = message.thinking;
    if (message.toolCalls.length) {
      wire.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
      }));
    }
    return wire;
  }

  return { role: 'tool', tool_call_id: message.callId, content: message.text };
}

export function buildChatCompletionsBody(
  messages: readonly NeutralMessage[],
  tools: readonly NeutralTool[],
  request: CustomStreamRequest
): Record<string, unknown> {
  const { model } = request;
  const body: Record<string, unknown> = {
    model: model.model,
    messages: messages.map((message) => wireMessage(message, request)),
    stream: true,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (model.maxOutputTokens) {
    // 新版 OpenAI 模型只认 max_completion_tokens，其余兼容网关普遍只认 max_tokens。
    body[isOfficialOpenAi(model.url) ? 'max_completion_tokens' : 'max_tokens'] =
      model.maxOutputTokens;
  }
  if (model.thinking) body.reasoning_effort = 'high';
  if (model.sessionHeaders && request.tracking) body.prompt_cache_key = request.tracking.sessionId;
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }
  return body;
}

function finishReason(value: unknown): FinishReason | undefined {
  if (value === 'length') return 'length';
  if (value === 'tool_calls' || value === 'function_call') return 'toolUse';
  if (typeof value === 'string' && value) return 'stop';
  return undefined;
}

function errorMessage(chunk: Record<string, unknown>): string | undefined {
  const error = chunk.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  const message = str(obj(error)?.message)?.trim();
  return message || undefined;
}

export function handleChatCompletionsEvent(event: SseEvent, sink: ChunkSink): void {
  if (event.data.trim() === '[DONE]') {
    sink.finish();
    return;
  }
  const chunk = parseEventData(event);
  if (!chunk) return;

  const failure = errorMessage(chunk);
  if (failure && !Array.isArray(chunk.choices)) {
    sink.fail(new Error(failure));
    return;
  }

  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const choice = obj(choices[0]);
  if (!choice) return;

  const delta = obj(choice.delta);
  if (delta) {
    // 思考内容字段在各家实现里叫法不同。
    const thinking = str(delta.reasoning_content) ?? str(delta.reasoning);
    if (thinking) sink.thinking(thinking);
    const content = str(delta.content);
    if (content) sink.text(content);

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    toolCalls.forEach((raw, position) => {
      const call = obj(raw);
      if (!call) return;
      const fn = obj(call.function);
      const id = str(call.id) || undefined;
      const key =
        typeof call.index === 'number' ? `i${call.index}` : id ? `id${id}` : `p${position}`;
      sink.toolStart(key, { id, name: str(fn?.name) });
      const args = str(fn?.arguments);
      if (args) sink.toolArgsDelta(key, args);
    });
  }

  const reason = finishReason(choice.finish_reason);
  if (reason) sink.stopReason(reason);
}
