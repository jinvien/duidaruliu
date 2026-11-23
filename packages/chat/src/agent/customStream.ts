import { getServiceFetch } from '../host';
import { sseFetch } from '../utils/sseFetch';
import { effectiveProtocol, type CustomModel, type CustomProtocol } from '../models/customModel';
import { buildChatCompletionsBody, handleChatCompletionsEvent } from './custom/chatCompletions';
import { createStreamCore, type ProtocolHandler } from './custom/core';
import { buildMessagesBody, handleMessagesEvent } from './custom/messages';
import { neutralTools, toNeutralMessages, type CustomStreamRequest } from './custom/neutral';
import { buildResponsesBody, handleResponsesEvent } from './custom/responses';

import type { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { Api, Message, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { NeutralMessage, NeutralTool } from './custom/neutral';

export type { CustomStreamRequest } from './custom/neutral';

const ANTHROPIC_VERSION = '2023-06-01';

type Adapter = {
  build: (
    messages: readonly NeutralMessage[],
    tools: readonly NeutralTool[],
    request: CustomStreamRequest
  ) => Record<string, unknown>;
  handle: ProtocolHandler;
};

const ADAPTERS: Record<CustomProtocol, Adapter> = {
  chat_completions: { build: buildChatCompletionsBody, handle: handleChatCompletionsEvent },
  responses: { build: buildResponsesBody, handle: handleResponsesEvent },
  messages: { build: buildMessagesBody, handle: handleMessagesEvent },
};

function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  );
}

/** 鉴权与追踪头。Key 为空时不发鉴权，适合本地无鉴权网关。 */
export function buildCustomHeaders(
  request: Pick<CustomStreamRequest, 'model' | 'tracking'>,
  protocol: CustomProtocol
): Record<string, string> {
  const { model } = request;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (model.apiKey) {
    headers.Authorization = `Bearer ${model.apiKey}`;
    // Claude 官方协议认 x-api-key，兼容网关两种都认。
    if (protocol === 'messages') headers['x-api-key'] = model.apiKey;
  }
  if (protocol === 'messages') headers['anthropic-version'] = ANTHROPIC_VERSION;
  if (model.sessionHeaders && request.tracking) {
    headers['X-Model-Request-Id'] = newRequestId();
    headers['X-QA-Id'] = request.tracking.qaId;
    headers['X-Session-Id'] = request.tracking.sessionId;
  }
  return headers;
}

/** pi 的 Model 只用来标注消息的 api 与 provider，真实参数都在 CustomModel 里。 */
export function customPiModel(model: CustomModel): Model<Api> {
  return {
    id: model.model,
    name: model.model,
    api: 'custom',
    provider: 'custom',
    baseUrl: model.url,
    reasoning: model.thinking,
    input: model.vision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextTokens ?? 0,
    maxTokens: model.maxOutputTokens ?? 0,
  } as Model<Api>;
}

/**
 * 立刻返回事件流，请求与解析在流内部完成。失败写入 error 事件，不向外抛。
 */
export function streamCustomChat(
  piModel: Model<Api>,
  context: { messages: readonly Message[] },
  options: SimpleStreamOptions | undefined,
  request: CustomStreamRequest
): AssistantMessageEventStream {
  const { stream, sink } = createStreamCore(piModel, request.model.model, options?.signal);
  const protocol = effectiveProtocol(request.model);
  const adapter = ADAPTERS[protocol];

  void (async () => {
    try {
      const messages = toNeutralMessages(context.messages, request);
      const tools = neutralTools(context.messages, request);
      await sseFetch(
        {
          url: request.model.url,
          method: 'POST',
          headers: buildCustomHeaders(request, protocol),
          body: JSON.stringify(adapter.build(messages, tools, request)),
          signal: options?.signal,
          fetchImpl: request.fetchImpl,
        },
        (event) => adapter.handle(event, sink)
      );
      // 多数协议有明确的结束事件，没有时以连接正常结束为准。
      sink.finish();
    } catch (error) {
      sink.fail(error);
    }
  })();

  return stream;
}

export type ConnectionTestResult = { ok: true; elapsedMs: number } | { ok: false; error: string };

const TEST_TIMEOUT_MS = 30_000;

/**
 * 走和聊天完全相同的请求链路发一句 hi，收到首个输出就算通过并立刻中止。
 * 这样 URL、鉴权、协议、模型名任何一项不对都会在这里暴露。
 */
export async function testCustomModelConnection(
  model: CustomModel,
  fetchImpl?: typeof fetch
): Promise<ConnectionTestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), TEST_TIMEOUT_MS);
  const startedAt = Date.now();
  const messages: Message[] = [{ role: 'user', content: 'hi', timestamp: startedAt }];
  try {
    const stream = streamCustomChat(
      customPiModel(model),
      { messages },
      { signal: controller.signal },
      {
        model,
        includeImages: false,
        includeTools: false,
        lang: 'en',
        translateSystemPrompt: '',
        translatePostfix: '',
        fetchImpl,
      }
    );
    for await (const event of stream) {
      if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'done') {
        return { ok: true, elapsedMs: Date.now() - startedAt };
      }
      if (event.type === 'error') {
        return { ok: false, error: event.error.errorMessage || 'error' };
      }
    }
    return { ok: false, error: 'empty response' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** 从 OpenAI 风格的 /models 取模型 id。失败一律返回空数组，只用来做输入联想。 */
export async function fetchRemoteModelIds(
  modelsUrl: string,
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<string[]> {
  try {
    const doFetch = fetchImpl ?? getServiceFetch();
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers['x-api-key'] = apiKey;
    }
    const response = await doFetch(modelsUrl, { headers, signal });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const list = (body as { data?: unknown })?.data;
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => (item as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}
