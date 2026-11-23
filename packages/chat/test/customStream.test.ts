/// <reference lib="dom" />
import { Agent } from '@earendil-works/pi-agent-core';
import {
  customPiModel,
  fetchRemoteModelIds,
  streamCustomChat,
  testCustomModelConnection,
} from '../src/agent/customStream';

import type { AssistantMessageEvent, Message, ToolCall } from '@earendil-works/pi-ai';
import type { CustomStreamRequest } from '../src/agent/customStream';
import type { CustomModel } from '../src/models/customModel';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function equal(actual: unknown, expected: unknown, message: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function withTimeout<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type Frame = { event?: string; data: unknown };

/** 每个事件之间用 \n\n 分隔，并故意切在事件中间，检查缓冲。 */
function sse(frames: Frame[], crlf = false): ReadableStream<Uint8Array> {
  const nl = crlf ? '\r\n' : '\n';
  const text = frames
    .map((frame) => {
      const data = typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data);
      return `${frame.event ? `event: ${frame.event}${nl}` : ''}data: ${data}${nl}${nl}`;
    })
    .join('');
  const bytes = new TextEncoder().encode(text);
  const pieces = [
    bytes.slice(0, 7),
    bytes.slice(7, Math.floor(bytes.length / 2)),
    bytes.slice(Math.floor(bytes.length / 2)),
  ];
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });
}

function model(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    id: 's1::model-a',
    serviceId: 's1',
    url: 'https://gateway.example.com/openapi/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'model-a',
    tools: true,
    vision: false,
    thinking: false,
    customProtocol: false,
    protocol: 'chat_completions',
    sessionHeaders: false,
    ...overrides,
  };
}

type Captured = { url: string; headers: Record<string, string>; body: Record<string, any> };

async function run(
  messages: Message[],
  frames: Frame[] | (() => Response),
  custom: CustomModel,
  request: Partial<CustomStreamRequest> = {},
  signal?: AbortSignal
) {
  let captured: Captured | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    captured = {
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body ?? '{}')),
    };
    if (typeof frames === 'function') return frames();
    return new Response(sse(frames), { status: 200 });
  };
  const stream = streamCustomChat(
    customPiModel(custom),
    { messages },
    { signal },
    {
      model: custom,
      includeImages: true,
      includeTools: false,
      lang: 'zh-CN',
      translateSystemPrompt: '翻译系统提示',
      translatePostfix: '请翻译成',
      fetchImpl,
      ...request,
    }
  );
  const events: AssistantMessageEvent[] = [];
  await withTimeout(
    (async () => {
      for await (const event of stream) events.push(event);
    })()
  );
  return { events, captured: captured as Captured };
}

function textOf(events: AssistantMessageEvent[]) {
  return events.map((e) => (e.type === 'text_delta' ? e.delta : '')).join('');
}
function thinkingOf(events: AssistantMessageEvent[]) {
  return events.map((e) => (e.type === 'thinking_delta' ? e.delta : '')).join('');
}
function terminal(events: AssistantMessageEvent[]) {
  return events.at(-1);
}
function doneMessage(events: AssistantMessageEvent[]) {
  const last = terminal(events);
  return last?.type === 'done' ? last.message : undefined;
}
function toolCallsOf(events: AssistantMessageEvent[]): ToolCall[] {
  const message = doneMessage(events);
  return (message?.content ?? []).filter((part): part is ToolCall => part.type === 'toolCall');
}

const user = (content: string, timestamp = 1): Message => ({ role: 'user', content, timestamp });

const tool = {
  name: 'echo',
  label: 'Echo',
  description: 'Echo a question',
  parameters: { type: 'object', properties: { q: { type: 'string' } } },
};

async function chatCompletions() {
  // 文本 + 思考，role 只在首包，结尾带 usage 包，以 [DONE] 收尾。
  {
    const { events, captured } = await run(
      [{ role: 'system', content: '保持简短', timestamp: 1 }, user('你好', 2)],
      [
        { data: { choices: [{ delta: { role: 'assistant', reasoning_content: '想' } }] } },
        { data: { choices: [{ delta: { reasoning_content: '一下' } }] } },
        { data: { choices: [{ delta: { content: '你' } }] } },
        { data: { choices: [{ delta: { content: '好' } }] } },
        { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
        { data: { choices: [], usage: { total_tokens: 3 } } },
        { data: '[DONE]' },
      ],
      model({ thinking: true, maxOutputTokens: 4096 })
    );
    equal(textOf(events), '你好', 'text');
    equal(thinkingOf(events), '想一下', 'reasoning_content becomes thinking');
    equal(doneMessage(events)?.stopReason, 'stop', 'stop reason');
    equal(doneMessage(events)?.model, 'model-a', 'message carries the configured model name');
    equal(
      captured.url,
      'https://gateway.example.com/openapi/v1/chat/completions',
      'url is used as is'
    );
    equal(captured.headers.Authorization, 'Bearer sk-test', 'bearer auth');
    assert(!('X-Session-Id' in captured.headers), 'no tracking headers by default');
    assert(!('x-api-key' in captured.headers), 'no x-api-key for chat completions');
    equal(captured.body.model, 'model-a', 'model');
    equal(captured.body.stream, true, 'stream');
    equal(captured.body.reasoning_effort, 'high', 'thinking param');
    equal(captured.body.max_tokens, 4096, 'max_tokens for compatible gateways');
    assert(!('max_completion_tokens' in captured.body), 'no max_completion_tokens off OpenAI');
    assert(!('prompt_cache_key' in captured.body), 'no cache key by default');
    equal(
      captured.body.messages,
      [
        { role: 'system', content: '保持简短' },
        { role: 'user', content: '你好' },
      ],
      'messages'
    );
  }

  // 官方 OpenAI 地址用 max_completion_tokens；不开思考不带 reasoning_effort；没有 key 不发鉴权。
  {
    const { captured } = await run(
      [user('hi')],
      [{ data: { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] } }],
      model({
        url: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        maxOutputTokens: 1000,
      })
    );
    equal(captured.body.max_completion_tokens, 1000, 'official OpenAI token field');
    assert(!('reasoning_effort' in captured.body), 'no thinking param');
    assert(!('Authorization' in captured.headers), 'no auth header without a key');
  }

  // 会话头与 prompt_cache_key；CRLF 换行也能解析。
  {
    const { events, captured } = await run(
      [user('hi')],
      () =>
        new Response(
          sse([{ data: { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] } }], true),
          { status: 200 }
        ),
      model({ customProtocol: true, sessionHeaders: true }),
      { tracking: { sessionId: 'sess-1', qaId: 'qa-1' } }
    );
    equal(textOf(events), 'ok', 'CRLF stream');
    equal(captured.headers['X-Session-Id'], 'sess-1', 'session header');
    equal(captured.headers['X-QA-Id'], 'qa-1', 'qa header');
    assert(
      /^[0-9a-f-]{8,}$/i.test(captured.headers['X-Model-Request-Id'] ?? ''),
      'request id header'
    );
    equal(captured.body.prompt_cache_key, 'sess-1', 'prompt_cache_key follows the session id');
  }

  // 开启了会话头也不能影响没有 tracking 的调用（测试连接）。
  {
    const { captured } = await run(
      [user('hi')],
      [{ data: { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] } }],
      model({ customProtocol: true, sessionHeaders: true })
    );
    assert(!('X-Session-Id' in captured.headers), 'no tracking without ids');
  }

  // 工具调用：参数分片、index 区分多个调用，finish_reason=tool_calls。
  {
    const { events, captured } = await run(
      [user('查')],
      [
        {
          data: {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_a', function: { name: 'echo', arguments: '' } },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }],
          },
        },
        {
          data: {
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }],
          },
        },
        {
          data: {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 1, id: 'call_b', function: { name: 'echo', arguments: '{"q":"yo"}' } },
                  ],
                },
              },
            ],
          },
        },
        { data: { choices: [{ delta: {}, finish_reason: 'tool_calls' }] } },
        { data: '[DONE]' },
      ],
      model({ tools: true }),
      { includeTools: true }
    );
    const calls = toolCallsOf(events);
    equal(
      calls.map((call) => [call.id, call.name, call.arguments]),
      [
        ['call_a', 'echo', { q: 'hi' }],
        ['call_b', 'echo', { q: 'yo' }],
      ],
      'tool calls'
    );
    equal(doneMessage(events)?.stopReason, 'toolUse', 'tool use stop reason');
    assert(!('tools' in captured.body), 'no tools in the body when the transcript declares none');
  }

  // 工具定义、assistant tool_calls、tool 结果、reasoning_content 回填、图片。
  {
    const messages: Message[] = [
      // Agent 循环会插入只带工具声明的空 system 消息，请求时工具从这里读。
      {
        role: 'system',
        content: '',
        timestamp: 1,
        toolsAdded: [
          { name: tool.name, description: tool.description, parameters: tool.parameters },
        ],
      } as Message,
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', data: 'QUJD', mimeType: 'image/png' },
        ],
        timestamp: 2,
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查' },
          { type: 'toolCall', id: 'call_1', name: 'echo', arguments: { q: 'x' } },
        ],
        api: 'custom',
        provider: 'custom',
        model: 'model-a',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 3,
      },
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'echo',
        content: [{ type: 'text', text: '结果' }],
        isError: false,
        timestamp: 4,
      },
    ];
    const withTools = await runWithTools(messages, model({ thinking: true, vision: true }), true);
    equal(
      withTools.body.tools,
      [
        {
          type: 'function',
          function: { name: 'echo', description: 'Echo a question', parameters: tool.parameters },
        },
      ],
      'tools are wrapped as functions'
    );
    equal(
      withTools.body.messages,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看图' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
          ],
        },
        {
          role: 'assistant',
          content: null,
          reasoning_content: '先查',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"q":"x"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '结果' },
      ],
      'history is replayed with reasoning and tool calls'
    );

    const noThinking = await runWithTools(messages, model({ thinking: false }), false, false);
    assert(
      !JSON.stringify(noThinking.body.messages).includes('reasoning_content'),
      'reasoning is not replayed for models without thinking'
    );
    assert(
      !JSON.stringify(noThinking.body.messages).includes('image_url'),
      'images are dropped when the model has no vision'
    );
  }

  // 翻译场景：给用户消息补目标语言，和 Ollama 链路一致。
  {
    const { captured } = await run(
      [{ role: 'system', content: '翻译系统提示', timestamp: 1 }, user('hello', 2)],
      [{ data: { choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] } }],
      model(),
      { temperature: 0.1 }
    );
    equal(captured.body.messages[1].content, 'hello \n 请翻译成中文', 'translate postfix');
    equal(captured.body.temperature, 0.1, 'temperature override');
  }

  // 失败：HTTP 错误带上服务端给的原因；流内 error 事件；中途断开保留已输出内容。
  {
    const { events } = await run(
      [user('hi')],
      () =>
        new Response(JSON.stringify({ error: { message: 'Invalid API key', type: 'auth' } }), {
          status: 401,
        }),
      model()
    );
    const last = terminal(events);
    assert(last?.type === 'error', 'http error ends in an error event');
    equal(
      last?.type === 'error' ? last.error.errorMessage : '',
      'HTTP 401: Invalid API key',
      'error text'
    );
  }
  {
    const { events } = await run([user('hi')], () => new Response('', { status: 429 }), model());
    const last = terminal(events);
    equal(
      last?.type === 'error' ? last.error.errorMessage : '',
      'HTTP 429',
      'status-only error keeps the shape useChat matches'
    );
  }
  {
    const { events } = await run(
      [user('hi')],
      [
        { data: { choices: [{ delta: { content: '部分' } }] } },
        { data: { error: { message: 'upstream exploded' } } },
      ],
      model()
    );
    const last = terminal(events);
    assert(last?.type === 'error', 'in-stream error');
    const kept = last?.type === 'error' ? last.error.content : [];
    equal(kept, [{ type: 'text', text: '部分' }], 'partial text is kept on failure');
    assert(
      (last?.type === 'error' ? last.error.errorMessage : '') === 'upstream exploded',
      'in-stream error message'
    );
  }
  {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: '半句' } }] })}\n\n`
          )
        );
        controller.signal.addEventListener('abort', () =>
          stream.error(new DOMException('aborted', 'AbortError'))
        );
      },
    });
    const pending = run(
      [user('hi')],
      () => new Response(body, { status: 200 }),
      model(),
      {},
      controller.signal
    );
    setTimeout(() => controller.abort(), 30);
    const { events } = await pending;
    const last = terminal(events);
    assert(last?.type === 'error' && last.reason === 'aborted', 'abort is reported as aborted');
    equal(
      last?.type === 'error' ? last.error.content : [],
      [{ type: 'text', text: '半句' }],
      'abort keeps the partial text'
    );
  }
}

/** 单独跑一次带工具声明的请求，看请求体。 */
async function runWithTools(
  messages: Message[],
  custom: CustomModel,
  includeTools: boolean,
  includeImages = true
) {
  let body: Record<string, any> = {};
  const fetchImpl: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      sse([{ data: { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] } }]),
      {
        status: 200,
      }
    );
  };
  const stream = streamCustomChat(customPiModel(custom), { messages }, undefined, {
    model: custom,
    includeImages,
    includeTools,
    lang: 'zh-CN',
    translateSystemPrompt: '',
    translatePostfix: '',
    fetchImpl,
  });
  await withTimeout(
    (async () => {
      for await (const event of stream) void event;
    })()
  );
  return { body };
}

async function responsesProtocol() {
  const custom = model({
    url: 'https://gateway.example.com/openapi/v1/responses',
    thinking: true,
    maxOutputTokens: 2048,
    customProtocol: true,
    protocol: 'responses',
    sessionHeaders: true,
  });
  const { events, captured } = await run(
    [
      { role: 'system', content: '保持简短', timestamp: 1 },
      user('你好', 2),
      {
        role: 'assistant',
        content: [{ type: 'text', text: '在' }],
        api: 'custom',
        provider: 'custom',
        model: 'model-a',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 3,
      },
      user('查一下', 4),
    ],
    [
      { event: 'response.created', data: { type: 'response.created', response: {} } },
      {
        event: 'response.reasoning_summary_text.delta',
        data: { type: 'response.reasoning_summary_text.delta', delta: '想' },
      },
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: '好' },
      },
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: '的' },
      },
      {
        event: 'response.output_item.added',
        data: {
          type: 'response.output_item.added',
          output_index: 2,
          item: {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'echo',
            arguments: '',
          },
        },
      },
      {
        event: 'response.function_call_arguments.delta',
        data: {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          item_id: 'fc_1',
          delta: '{"q":',
        },
      },
      {
        event: 'response.function_call_arguments.delta',
        data: {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          item_id: 'fc_1',
          delta: '"hi"}',
        },
      },
      {
        event: 'response.function_call_arguments.done',
        data: {
          type: 'response.function_call_arguments.done',
          output_index: 2,
          item_id: 'fc_1',
          arguments: '{"q":"hi"}',
        },
      },
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: 2,
          item: {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'echo',
            arguments: '{"q":"hi"}',
          },
        },
      },
      {
        event: 'response.completed',
        data: { type: 'response.completed', response: { status: 'completed' } },
      },
    ],
    custom,
    { includeTools: true, tracking: { sessionId: 'sess-2', qaId: 'qa-2' } }
  );
  equal(textOf(events), '好的', 'responses text');
  equal(thinkingOf(events), '想', 'responses reasoning');
  equal(
    toolCallsOf(events).map((call) => [call.id, call.name, call.arguments]),
    [['call_1', 'echo', { q: 'hi' }]],
    'responses tool call uses call_id and is not duplicated by the done events'
  );
  equal(doneMessage(events)?.stopReason, 'toolUse', 'responses tool use');
  equal(captured.url, 'https://gateway.example.com/openapi/v1/responses', 'responses url');
  equal(captured.headers.Authorization, 'Bearer sk-test', 'responses auth');
  equal(captured.headers['X-Session-Id'], 'sess-2', 'responses session header');
  equal(captured.body.instructions, '保持简短', 'system goes to instructions');
  equal(captured.body.reasoning, { effort: 'high' }, 'responses reasoning param');
  equal(captured.body.max_output_tokens, 2048, 'responses output limit');
  equal(captured.body.prompt_cache_key, 'sess-2', 'responses cache key');
  equal(
    captured.body.input,
    [
      { role: 'user', content: [{ type: 'input_text', text: '你好' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: '在' }] },
      { role: 'user', content: [{ type: 'input_text', text: '查一下' }] },
    ],
    'responses input items'
  );

  // 只给完整调用的实现（没有 added / delta）。
  {
    const { events: bare } = await run(
      [user('x')],
      [
        {
          data: {
            type: 'response.output_item.done',
            output_index: 0,
            item: { type: 'function_call', call_id: 'c9', name: 'echo', arguments: '{"q":"z"}' },
          },
        },
        {
          data: {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
          },
        },
      ],
      custom
    );
    equal(
      toolCallsOf(bare).map((call) => call.arguments),
      [{ q: 'z' }],
      'done-only function call'
    );
  }

  {
    const { events: cut } = await run(
      [user('x')],
      [
        { data: { type: 'response.output_text.delta', delta: '很长' } },
        {
          data: {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
          },
        },
      ],
      custom
    );
    equal(doneMessage(cut)?.stopReason, 'length', 'responses length');
  }

  {
    const { events: failure } = await run(
      [user('x')],
      [{ data: { type: 'response.failed', response: { error: { message: 'quota exceeded' } } } }],
      custom
    );
    const last = terminal(failure);
    equal(
      last?.type === 'error' ? last.error.errorMessage : '',
      'quota exceeded',
      'responses failure'
    );
  }

  // 工具结果回填与图片。
  {
    const { captured: replay } = await run(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看' },
            { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' },
          ],
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call_1', name: 'echo', arguments: { q: 'x' } }],
          api: 'custom',
          provider: 'custom',
          model: 'model-a',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'echo',
          content: [{ type: 'text', text: '结果' }],
          isError: false,
          timestamp: 3,
        },
      ],
      [{ data: { type: 'response.completed', response: {} } }],
      custom
    );
    equal(
      replay.body.input,
      [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '看' },
            { type: 'input_image', image_url: 'data:image/jpeg;base64,QUJD' },
          ],
        },
        { type: 'function_call', call_id: 'call_1', name: 'echo', arguments: '{"q":"x"}' },
        { type: 'function_call_output', call_id: 'call_1', output: '结果' },
      ],
      'responses replays tool calls and images'
    );
  }
}

async function claudeMessages() {
  const custom = model({
    url: 'https://gateway.example.com/openapi/v1/messages',
    thinking: true,
    maxOutputTokens: 4096,
    vision: true,
  });
  const assistantWithSignature: Message = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '先查', thinkingSignature: 'sig-1' },
      { type: 'toolCall', id: 'toolu_1', name: 'echo', arguments: { q: 'x' } },
    ],
    api: 'custom',
    provider: 'custom',
    model: 'model-a',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 3,
  };

  const { events, captured } = await run(
    [
      { role: 'system', content: '保持简短', timestamp: 1 },
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', data: 'QUJD', mimeType: 'image/png' },
        ],
        timestamp: 2,
      },
      assistantWithSignature,
      {
        role: 'toolResult',
        toolCallId: 'toolu_1',
        toolName: 'echo',
        content: [{ type: 'text', text: '结果' }],
        isError: true,
        timestamp: 4,
      },
      user('继续', 5),
    ],
    [
      { event: 'message_start', data: { type: 'message_start', message: { usage: {} } } },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '想' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'sig-2' },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'ping', data: { type: 'ping' } },
      {
        event: 'content_block_start',
        data: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      },
      {
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '好' } },
      },
      {
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '的' } },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'toolu_2', name: 'echo', input: {} },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '{"q":' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '"hi"}' },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
      {
        event: 'message_delta',
        data: { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ],
    custom,
    { includeTools: true }
  );
  equal(textOf(events), '好的', 'messages text');
  equal(thinkingOf(events), '想', 'messages thinking');
  const message = doneMessage(events);
  const thinking = message?.content.find((part) => part.type === 'thinking');
  equal(
    thinking?.type === 'thinking' ? thinking.thinkingSignature : '',
    'sig-2',
    'signature is kept on the thinking block'
  );
  equal(
    toolCallsOf(events).map((call) => [call.id, call.name, call.arguments]),
    [['toolu_2', 'echo', { q: 'hi' }]],
    'tool_use block'
  );
  equal(message?.stopReason, 'toolUse', 'messages tool use');

  equal(captured.url, 'https://gateway.example.com/openapi/v1/messages', 'messages url');
  equal(captured.headers.Authorization, 'Bearer sk-test', 'messages bearer auth');
  equal(captured.headers['x-api-key'], 'sk-test', 'messages x-api-key');
  equal(captured.headers['anthropic-version'], '2023-06-01', 'anthropic-version');
  equal(captured.body.system, '保持简短', 'system is top level');
  equal(captured.body.max_tokens, 4096, 'max_tokens');
  equal(captured.body.thinking, { type: 'enabled', budget_tokens: 2048 }, 'thinking budget');
  assert(!('temperature' in captured.body), 'no temperature while thinking');
  equal(
    captured.body.messages,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查', signature: 'sig-1' },
          { type: 'tool_use', id: 'toolu_1', name: 'echo', input: { q: 'x' } },
        ],
      },
      {
        // 工具结果和随后的用户消息合并到同一条 user 里，保证角色交替。
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '结果', is_error: true },
          { type: 'text', text: '继续' },
        ],
      },
    ],
    'messages history is alternating and replays signed thinking'
  );

  // 默认 max_tokens、小上限时不开思考、无签名不回填思考、可以带温度。
  {
    const small = model({
      url: 'https://gateway.example.com/openapi/v1/messages',
      thinking: true,
      maxOutputTokens: 1000,
    });
    const { captured: smallReq } = await run(
      [user('x')],
      [{ data: { type: 'message_stop' } }],
      small,
      { temperature: 0.2 }
    );
    assert(
      !('thinking' in smallReq.body),
      'no thinking when max_tokens leaves no room for the budget'
    );
    equal(smallReq.body.temperature, 0.2, 'temperature when not thinking');

    const unsigned: Message = {
      ...assistantWithSignature,
      content: [
        { type: 'thinking', thinking: '没有签名' },
        { type: 'text', text: '答' },
      ],
    };
    const { captured: plain } = await run(
      [user('x'), unsigned, user('y', 9)],
      [{ data: { type: 'message_stop' } }],
      model({ url: 'https://gateway.example.com/openapi/v1/messages', thinking: true })
    );
    equal(plain.body.max_tokens, 16384, 'default max_tokens with thinking');
    assert(
      !JSON.stringify(plain.body.messages).includes('没有签名'),
      'unsigned thinking is not replayed'
    );
  }

  {
    const { events: cut } = await run(
      [user('x')],
      [
        {
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '截断' },
          },
        },
        { data: { type: 'message_delta', delta: { stop_reason: 'max_tokens' } } },
        { data: { type: 'message_stop' } },
      ],
      custom
    );
    equal(doneMessage(cut)?.stopReason, 'length', 'max_tokens maps to length');
  }
  {
    const { events: failure } = await run(
      [user('x')],
      [
        {
          event: 'error',
          data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        },
      ],
      custom
    );
    const last = terminal(failure);
    equal(
      last?.type === 'error' ? last.error.errorMessage : '',
      'Overloaded',
      'messages error event'
    );
  }
}

async function connectionTest() {
  const ok = await testCustomModelConnection(
    model(),
    (async () =>
      new Response(sse([{ data: { choices: [{ delta: { content: 'hi' } }] } }]), {
        status: 200,
      })) as typeof fetch
  );
  assert(ok.ok, 'connection test passes on the first token');

  const bad = await testCustomModelConnection(
    model(),
    (async () =>
      new Response(JSON.stringify({ error: { message: 'bad key' } }), {
        status: 401,
      })) as typeof fetch
  );
  assert(
    !bad.ok && bad.error === 'HTTP 401: bad key',
    `connection test reports the server reason, got ${JSON.stringify(bad)}`
  );

  const ids = await fetchRemoteModelIds(
    'https://gateway.example.com/openapi/v1/models',
    'sk-test',
    undefined,
    (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          data:
            headers.Authorization === 'Bearer sk-test'
              ? [{ id: 'model-a' }, { id: 'model-b' }, {}]
              : [],
        }),
        { status: 200 }
      );
    }) as typeof fetch
  );
  equal(ids, ['model-a', 'model-b'], 'remote model ids');
  equal(
    await fetchRemoteModelIds(
      'https://x/models',
      '',
      undefined,
      (async () => new Response('nope', { status: 500 })) as typeof fetch
    ),
    [],
    'model list failures are swallowed'
  );
}

async function agentLoop() {
  const bodies: Array<Record<string, any>> = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    if (calls === 1) {
      return new Response(
        sse([
          { data: { choices: [{ delta: { reasoning_content: '先查' } }] } },
          {
            data: {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: { name: 'echo', arguments: '{"q":"hi"}' },
                      },
                    ],
                  },
                },
              ],
            },
          },
          { data: { choices: [{ delta: {}, finish_reason: 'tool_calls' }] } },
          { data: '[DONE]' },
        ]),
        { status: 200 }
      );
    }
    return new Response(
      sse([
        { data: { choices: [{ delta: { content: '完成' }, finish_reason: 'stop' }] } },
        { data: '[DONE]' },
      ]),
      { status: 200 }
    );
  };
  const custom = model({ thinking: true, tools: true });
  const agent = new Agent({
    initialState: { thinkingLevel: 'off', tools: [], messages: [] },
    toolExecution: 'sequential',
    streamFn: (piModel, context, options) =>
      streamCustomChat(piModel, context, options, {
        model: custom,
        includeImages: false,
        includeTools: true,
        lang: 'zh-CN',
        translateSystemPrompt: '',
        translatePostfix: '',
        fetchImpl,
      }),
  });
  agent.state.tools = [
    {
      ...tool,
      execute: async () => ({ content: [{ type: 'text', text: '回声' }], details: {} }),
    },
  ];
  agent.state.messages = [user('查一下')];
  await withTimeout(agent.continue());

  equal(calls, 2, 'the loop makes a second request after the tool result');
  assert(
    Array.isArray(bodies[0].tools) && bodies[0].tools.length === 1,
    'first request declares the tool'
  );
  const second = bodies[1].messages as Array<Record<string, any>>;
  equal(
    second.at(-1),
    { role: 'tool', tool_call_id: 'call_1', content: '回声' },
    'tool result is sent back'
  );
  equal(second.at(-2)?.reasoning_content, '先查', 'reasoning is passed back inside the loop');
  equal(second.at(-2)?.tool_calls?.[0]?.id, 'call_1', 'tool call id is kept');
  const last = agent.state.messages.at(-1);
  assert(
    last?.role === 'assistant' &&
      last.content.some((part) => part.type === 'text' && part.text === '完成'),
    'final answer is stored'
  );
  assert(!agent.state.isStreaming, 'agent is idle');
}

async function main() {
  await chatCompletions();
  await responsesProtocol();
  await claudeMessages();
  await connectionTest();
  await agentLoop();
  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('custom stream fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  throw error;
});
