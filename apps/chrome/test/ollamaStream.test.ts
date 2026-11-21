/// <reference lib="dom" />
import { Agent } from '@earendil-works/pi-agent-core';
import { streamOllamaChat, foldAssistantText } from '../src/agent/ollamaStream';

import type { Api, AssistantMessageEvent, Message, Model } from '@earendil-works/pi-ai';
import type { OllamaStreamRequest } from '../src/agent/ollamaStream';

const model = {
  id: 'qwen2.5',
  name: 'qwen2.5',
  api: 'ollama',
  provider: 'ollama',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
} as Model<Api>;

const baseRequest: OllamaStreamRequest = {
  url: 'http://127.0.0.1:11434/api/chat',
  modelParams: { model: 'qwen2.5', options: { temperature: 0.2 }, keep_alive: 300 },
  includeImages: true,
  lang: 'zh-CN',
  translateSystemPrompt: '翻译系统提示',
  translatePostfix: '请将上方内容翻译成',
};

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function ndjson(chunks: unknown[]): ReadableStream<Uint8Array> {
  const payload = chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n';
  const bytes = new TextEncoder().encode(payload);
  const split = Math.max(1, Math.floor(bytes.length / 2));
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
}

async function collect(
  events: AsyncIterable<AssistantMessageEvent>
): Promise<AssistantMessageEvent[]> {
  const list: AssistantMessageEvent[] = [];
  for await (const event of events) list.push(event);
  return list;
}

async function run(
  messages: Message[],
  chunks: unknown[],
  request: Partial<OllamaStreamRequest> = {},
  respond?: () => Response
) {
  let captured:
    | { url: string; body: Record<string, unknown>; signal: AbortSignal | null }
    | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    captured = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      signal: init?.signal ?? null,
    };
    if (respond) return respond();
    return new Response(ndjson(chunks), { status: 200 });
  };
  const stream = streamOllamaChat(
    model,
    { messages },
    { signal: capturedSignal },
    {
      ...baseRequest,
      ...request,
      fetchImpl,
    }
  );
  const events = await withTimeout(collect(stream));
  return { events, captured };
}

let capturedSignal: AbortSignal | undefined;

function textOf(events: AssistantMessageEvent[]): string {
  return events
    .filter((event) => event.type === 'text_delta')
    .map((event) => (event.type === 'text_delta' ? event.delta : ''))
    .join('');
}

function thinkingOf(events: AssistantMessageEvent[]): string {
  return events
    .filter((event) => event.type === 'thinking_delta')
    .map((event) => (event.type === 'thinking_delta' ? event.delta : ''))
    .join('');
}

function doneReason(events: AssistantMessageEvent[]): string | undefined {
  const done = events.find((event) => event.type === 'done');
  return done?.type === 'done' ? done.reason : undefined;
}

async function main() {
  {
    const messages: Message[] = [
      { role: 'system', content: '保持简短', timestamp: 1 },
      { role: 'user', content: '你好', timestamp: 2 },
    ];
    const { events, captured } = await run(messages, [
      { message: { role: 'assistant', content: '你' }, done: false },
      { message: { role: 'assistant', content: '好' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
    ]);
    assert(textOf(events) === '你好', `text deltas, got ${textOf(events)}`);
    assert(
      events.some((event) => event.type === 'text_start'),
      'text_start'
    );
    assert(
      events.some((event) => event.type === 'text_end'),
      'text_end'
    );
    assert(doneReason(events) === 'stop', 'done stop');
    assert(captured?.url === 'http://127.0.0.1:11434/api/chat', 'native chat url');
    assert(
      JSON.stringify(captured?.body) ===
        JSON.stringify({
          messages: [
            { role: 'system', content: '保持简短' },
            { role: 'user', content: '你好' },
          ],
          model: 'qwen2.5',
          options: { temperature: 0.2 },
          keep_alive: 300,
        }),
      `body ${JSON.stringify(captured?.body)}`
    );
    assert(!captured?.body || !('tools' in captured.body), 'no tools field');
    assert(!captured?.body || !('think' in captured.body), 'no think field');
  }

  {
    const messages: Message[] = [{ role: 'user', content: '想一下', timestamp: 1 }];
    const { events } = await run(messages, [
      { message: { role: 'assistant', content: '', thinking: '先' }, done: false },
      { message: { role: 'assistant', content: '', thinking: '想' }, done: false },
      { message: { role: 'assistant', content: '答', thinking: '' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
    ]);
    assert(thinkingOf(events) === '先想', `thinking, got ${thinkingOf(events)}`);
    assert(textOf(events) === '答', `thinking answer, got ${textOf(events)}`);
    assert(
      events.some((event) => event.type === 'thinking_start'),
      'thinking_start'
    );
    assert(
      events.some((event) => event.type === 'thinking_end'),
      'thinking_end'
    );
    assert(foldAssistantText('先想', '答') === '<think>先想</think>答', 'fold thinking');
    assert(
      foldAssistantText('先想', '<think>已有</think>答') === '<think>已有</think>答',
      'one think source'
    );
  }

  {
    const messages: Message[] = [{ role: 'user', content: '截断', timestamp: 1 }];
    const { events } = await run(messages, [
      { message: { role: 'assistant', content: '' }, done: false },
      {
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'now' } }] },
        done: false,
      },
      { message: { role: 'assistant', content: '部分' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'length' },
    ]);
    assert(textOf(events) === '部分', `empty chunks kept later text, got ${textOf(events)}`);
    assert(doneReason(events) === 'toolUse', `tool call on empty chunk, got ${doneReason(events)}`);
  }

  {
    const messages: Message[] = [{ role: 'user', content: '截断', timestamp: 1 }];
    const { events } = await run(messages, [
      { message: { role: 'assistant', content: '部分' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'length' },
    ]);
    assert(doneReason(events) === 'length', `length, got ${doneReason(events)}`);
  }

  {
    const controller = new AbortController();
    capturedSignal = controller.signal;
    let sawSignal = false;
    const messages: Message[] = [{ role: 'user', content: '停', timestamp: 1 }];
    const { events, captured } = await run(messages, [], {}, () => {
      sawSignal = true;
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    capturedSignal = undefined;
    assert(sawSignal, 'fetch was called');
    assert(captured?.signal === controller.signal, 'abort signal passed to fetch');
    const error = events.find((event) => event.type === 'error');
    assert(error?.type === 'error' && error.reason === 'aborted', `abort, got ${error?.type}`);
    assert(
      events.every((event) => event.type !== 'done'),
      'abort is not done'
    );
  }

  {
    const messages: Message[] = [{ role: 'user', content: '坏了', timestamp: 1 }];
    const { events } = await run(messages, [], {}, () => {
      return new Response(JSON.stringify({ error: 'model not found' }), { status: 500 });
    });
    const error = events.find((event) => event.type === 'error');
    assert(error?.type === 'error' && error.reason === 'error', 'http error event');
    assert(
      error?.type === 'error' && error.error.errorMessage === 'model not found',
      `http detail, got ${error?.type === 'error' ? error.error.errorMessage : ''}`
    );
  }

  {
    const raw = 'iVBORw0KGgo=';
    const messages: Message[] = [
      { role: 'system', content: '翻译系统提示', timestamp: 1 },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', data: raw, mimeType: 'image/png' },
        ],
        timestamp: 2,
      },
    ];
    const seen = await run(messages, [
      { message: { role: 'assistant', content: 'ok' }, done: true, done_reason: 'stop' },
    ]);
    const wire = seen.captured?.body.messages as Array<Record<string, unknown>>;
    assert(wire[0]?.role === 'system' && wire[0]?.content === '翻译系统提示', 'system order');
    assert(
      wire[1]?.content === 'hello \n 请将上方内容翻译成中文',
      `postfix, got ${wire[1]?.content}`
    );
    assert(JSON.stringify(wire[1]?.images) === JSON.stringify([raw]), 'raw base64 images');

    const hidden = await run(
      messages,
      [{ message: { role: 'assistant', content: 'ok' }, done: true, done_reason: 'stop' }],
      { includeImages: false }
    );
    const hiddenUser = (hidden.captured?.body.messages as Array<Record<string, unknown>>)[1];
    assert(!hiddenUser || !('images' in hiddenUser), 'no images without vision');
  }

  {
    let body: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        ndjson([
          { message: { role: 'assistant', content: '你' }, done: false },
          { message: { role: 'assistant', content: '好' }, done: true, done_reason: 'stop' },
        ]),
        { status: 200 }
      );
    };
    const agent = new Agent({
      initialState: { thinkingLevel: 'off', tools: [], messages: [] },
      toolExecution: 'sequential',
      streamFn: (nextModel, context, options) =>
        streamOllamaChat(nextModel, context, options, { ...baseRequest, fetchImpl }),
    });
    agent.state.messages = [{ role: 'user', content: '你好', timestamp: 1 }];
    const deltas: string[] = [];
    agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        deltas.push(event.assistantMessageEvent.delta);
      }
    });
    await withTimeout(agent.continue());
    assert(deltas.join('') === '你好', `agent deltas, got ${deltas.join('')}`);
    assert(agent.state.messages.at(-1)?.role === 'assistant', 'agent stored the assistant turn');
    assert(!agent.state.isStreaming, 'agent is idle');
    assert(
      JSON.stringify(body?.messages) === JSON.stringify([{ role: 'user', content: '你好' }]),
      `agent body ${JSON.stringify(body?.messages)}`
    );
    assert(!body || !('tools' in body), 'agent request has no tools');
    assert(!body || !('think' in body), 'agent request has no think');
  }

  {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls > 1) {
        return new Response(
          ndjson([{ message: { role: 'assistant', content: '好' }, done: true, done_reason: 'stop' }]),
          { status: 200 }
        );
      }
      return new Response(
        ndjson([
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'now' } }],
            },
            done: false,
          },
          { message: { role: 'assistant', content: '部分' }, done: true, done_reason: 'stop' },
        ]),
        { status: 200 }
      );
    };
    const agent = new Agent({
      initialState: { thinkingLevel: 'off', tools: [], messages: [] },
      toolExecution: 'sequential',
      streamFn: (nextModel, context, options) =>
        streamOllamaChat(nextModel, context, options, { ...baseRequest, fetchImpl }),
    });
    agent.state.messages = [{ role: 'user', content: '调用', timestamp: 1 }];
    await withTimeout(agent.continue());
    const assistant = agent.state.messages.at(-1);
    assert(calls === 2, `unknown tool call continued once, fetches=${calls}`);
    assert(
      agent.state.messages.some(
        (message) =>
          message.role === 'assistant' && message.content.some((part) => part.type === 'toolCall')
      ),
      'tool call is part of the assistant message'
    );
    assert(assistant?.role === 'assistant', 'toolUse turn stored an assistant message');
    assert(!agent.state.isStreaming, 'toolUse turn is idle');
  }

  if (failed) {
    throw new Error(`${failed} assertion(s) failed`);
  }
  console.log('ollama stream fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
