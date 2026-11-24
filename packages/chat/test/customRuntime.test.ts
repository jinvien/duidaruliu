/// <reference lib="dom" />
import { createMemoryStorage, installChatHost } from '../src/host';

export {};

const browserWindow = globalThis.window ?? {
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
};
if (!globalThis.window) {
  Object.defineProperty(globalThis, 'window', { value: browserWindow, configurable: true });
}
if (typeof globalThis.window.matchMedia !== 'function') {
  globalThis.window.matchMedia = () =>
    ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
}

Object.defineProperty(globalThis, 'chrome', {
  value: {
    storage: {
      sync: {
        get: async (key: string) =>
          key === 'appSettings' ? { appSettings: { lang: 'zh-CN' } } : {},
        set: async () => {},
      },
      local: { get: async () => ({}), set: async () => {} },
    },
    runtime: { getURL: (path: string) => path },
  },
  configurable: true,
});

const storage = createMemoryStorage();
installChatHost({ storage, openSettings() {} });

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

function withTimeout<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > ms) return reject(new Error('timed out'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function sse(frames: unknown[]) {
  return `${frames.map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join('')}`;
}

const text = (content: string) => [
  { choices: [{ delta: { content }, finish_reason: 'stop' }] },
  '[DONE]',
];

type Call = { url: string; headers: Record<string, string>; body: Record<string, any> };

async function main() {
  const { default: store } = await import('../src/store/index.ts');
  const { setMessages } = await import('../src/store/chatSlice.ts');
  const { setOllamaModelParams, setOllamaUrl } = await import('../src/store/ollamaSlice.ts');
  const { setMcpToolsEnabled } = await import('../src/store/mcpSlice.ts');
  const {
    hydrateCustomModels,
    saveCustomService,
    setActiveCustomModel,
    removeCustomService,
    setCustomModelThinking,
    setCustomModelContext,
  } = await import('../src/store/customModelSlice.ts');
  const {
    selectActiveContextWindow,
    selectBackendReady,
    selectSelectedModelKey,
    selectSelectedModelLabel,
  } = await import('../src/models/selection.ts');
  const { selectContextLimit } = await import('../src/page/contextLimit.ts');
  const runtime = await import('../src/agent/runtime.ts');

  store.dispatch(setOllamaUrl('http://127.0.0.1:11434'));
  store.dispatch(setOllamaModelParams({ model: 'qwen2.5' }));

  const calls: Call[] = [];
  let script: Array<() => Response> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    const next = script.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof fetch;

  // 界面靠这个通知刷新。每次通知时读到的 isStreaming 必须最终落在 false，
  // 否则最后一次渲染停在「仍在流式」，附件按钮会一直灰着，直到别的状态变化触发重渲染。
  const observed: boolean[] = [];
  runtime.subscribeAgentActivity(() => observed.push(runtime.agentIsStreaming()));
  const settledAfter = async (label: string, turn: () => Promise<void>) => {
    observed.length = 0;
    await turn();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(observed.length > 0, `${label}: activity listeners are notified`);
    assert(
      observed.at(-1) === false,
      `${label}: last activity notification must see an idle agent, saw ${JSON.stringify(observed)}`
    );
  };

  const reply = (frames: unknown[]) => () => new Response(sse(frames), { status: 200 });

  // 一个服务，两个模型：地址和 Key 只配一次。
  const custom = {
    id: 's1',
    url: 'https://gateway.example.com/openapi/v1/chat/completions',
    apiKey: 'sk-test',
    models: ['model-a', 'model-b'],
    tools: true,
    vision: false,
    thinking: false,
    customProtocol: true,
    protocol: 'chat_completions' as const,
    sessionHeaders: true,
    contextWindows: [307200, 614400, 983040],
  };

  // 没有自定义模型时走 Ollama。
  assert(!selectBackendReady(store.getState()), 'ollama is not marked running in this fixture');
  equal(selectSelectedModelKey(store.getState()), 'qwen2.5', 'ollama key');

  await store.dispatch(saveCustomService(custom));
  assert(
    JSON.stringify((await storage.get('local', 'customServices')).customServices) ===
      JSON.stringify([custom]),
    'saving persists the services to the local area, not sync'
  );
  assert(
    (await storage.get('sync', 'customServices')).customServices === undefined,
    'API keys never reach the sync area'
  );

  await store.dispatch(setActiveCustomModel('s1::model-a'));
  equal(
    (await storage.get('local', 'activeCustomModelId')).activeCustomModelId,
    's1::model-a',
    'active id persisted'
  );
  equal(selectSelectedModelKey(store.getState()), 'custom:s1::model-a', 'custom key');
  equal(selectSelectedModelLabel(store.getState()), 'model-a', 'custom label is the model name');
  assert(selectBackendReady(store.getState()), 'custom models do not depend on a running Ollama');

  // 第一次提问：走自定义模型，消息上记录模型名。
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '你好', createdAt: 1 }] }));
  script = [reply(text('你好呀'))];
  await settledAfter('custom turn', () => withTimeout(runtime.startAssistantTurn()));
  const first = calls[0];
  equal(first.url, custom.url, 'custom model url');
  equal(first.headers.Authorization, 'Bearer sk-test', 'bearer auth');
  equal(first.body.model, 'model-a', 'model in body');
  const answer = store.getState().chat.messages.at(-1);
  equal(
    [answer?.role, answer?.content, answer?.model],
    ['assistant', '你好呀', 'model-a'],
    'assistant message'
  );

  // 同一个对话里再问一次：session 不变，qa 变化。
  store.dispatch(
    setMessages({
      messages: [
        ...store.getState().chat.messages,
        { role: 'user', content: '再问', createdAt: 2 },
      ],
    })
  );
  script = [reply(text('好的'))];
  await withTimeout(runtime.startAssistantTurn());
  const second = calls[1];
  equal(
    second.headers['X-Session-Id'],
    first.headers['X-Session-Id'],
    'same conversation keeps the session id'
  );
  assert(second.headers['X-QA-Id'] !== first.headers['X-QA-Id'], 'each question gets a new qa id');
  equal(second.body.prompt_cache_key, first.body.prompt_cache_key, 'cache key follows the session');

  // 新对话换 session。
  assert(runtime.resetAgentTranscript(), 'reset works while idle');
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '新话题', createdAt: 3 }] }));
  script = [reply(text('嗯'))];
  await withTimeout(runtime.startAssistantTurn());
  assert(
    calls[2].headers['X-Session-Id'] !== first.headers['X-Session-Id'],
    'a new conversation gets a new session id'
  );

  // 工具循环：一次提问里的多轮调用共用 qa id，工具能力来自模型自己的声明。
  store.dispatch(setMcpToolsEnabled(true));
  runtime.setAgentTools([
    {
      name: 'echo',
      label: '回声',
      description: 'Echo',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async () => ({ content: [{ type: 'text', text: '回声结果' }], details: {} }),
    },
  ]);
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '查', createdAt: 4 }] }));
  script = [
    reply([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'echo', arguments: '{"q":"hi"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      '[DONE]',
    ]),
    reply(text('查完了')),
  ];
  const before = calls.length;
  const toolTurn = runtime.startAssistantTurn();
  await waitFor(() => runtime.getPendingToolApproval()?.id === 'echo');
  runtime.decideToolApproval('session');
  await withTimeout(toolTurn);
  const loop = calls.slice(before);
  equal(loop.length, 2, 'tool loop makes two requests');
  equal(loop[1].headers['X-QA-Id'], loop[0].headers['X-QA-Id'], 'tool loop shares one qa id');
  assert(
    Array.isArray(loop[0].body.tools) && loop[0].body.tools.length === 1,
    'tools are sent for a tools-capable custom model'
  );
  equal(
    loop[1].body.messages.at(-1),
    { role: 'tool', tool_call_id: 'call_1', content: '回声结果' },
    'tool result'
  );
  equal(store.getState().chat.messages.at(-1)?.content, '查完了', 'final answer');

  // 模型声明不支持工具：即便总开关打开也不带 tools。
  await store.dispatch(saveCustomService({ ...custom, tools: false }));
  runtime.refreshAgentTools();
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '再查', createdAt: 5 }] }));
  script = [reply(text('不用工具'))];
  const noTools = calls.length;
  await withTimeout(runtime.startAssistantTurn());
  assert(!('tools' in calls[noTools].body), 'no tools for a model declared without tool calling');

  // 来自存储订阅的同步不会回写（设置页与聊天页是两份文档）。
  const writes: string[] = [];
  const unsubscribe = storage.subscribe((changes) => writes.push(...Object.keys(changes)));
  store.dispatch(
    hydrateCustomModels({
      services: [{ ...custom, tools: false }],
      activeId: 's1::model-a',
      hasServices: true,
      hasActive: true,
    })
  );
  unsubscribe();
  equal(writes, [], 'hydrate does not write back to storage');

  // 同一个服务下切换模型：只换请求里的 model，地址和 Key 不变。
  await store.dispatch(setActiveCustomModel('s1::model-b'));
  equal(selectSelectedModelKey(store.getState()), 'custom:s1::model-b', 'second model key');
  equal(selectSelectedModelLabel(store.getState()), 'model-b', 'second model label');
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '换一个', createdAt: 7 }] }));
  script = [reply(text('我是 model-b'))];
  const switched = calls.length;
  await withTimeout(runtime.startAssistantTurn());
  equal(calls[switched].body.model, 'model-b', 'the other model of the same service is requested');
  equal(calls[switched].url, custom.url, 'same endpoint');
  equal(calls[switched].headers.Authorization, 'Bearer sk-test', 'same key');
  equal(store.getState().chat.messages.at(-1)?.model, 'model-b', 'message records the model name');

  // 选择模型时关掉思考：开关按模型保存、会持久化，只有声明了思考模式的服务才会带参数。
  await store.dispatch(saveCustomService({ ...custom, tools: false, thinking: true }));
  await store.dispatch(setCustomModelThinking('s1::model-b', false));
  equal(
    store.getState().customModel.thinkingOff,
    ['s1::model-b'],
    'thinking switched off for model-b'
  );
  equal(
    (await storage.get('local', 'customThinkingOff')).customThinkingOff,
    ['s1::model-b'],
    'thinking switch is persisted'
  );
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '别想', createdAt: 8 }] }));
  script = [reply(text('好'))];
  const thinkOff = calls.length;
  await withTimeout(runtime.startAssistantTurn());
  equal(calls[thinkOff].body.reasoning_effort, 'no_think', 'switched-off model sends no_think');

  await store.dispatch(setActiveCustomModel('s1::model-a'));
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '想想', createdAt: 9 }] }));
  script = [reply(text('好'))];
  const thinkOn = calls.length;
  await withTimeout(runtime.startAssistantTurn());
  equal(calls[thinkOn].body.reasoning_effort, 'high', 'the other model keeps thinking on');
  await store.dispatch(setActiveCustomModel('s1::model-b'));

  // 上下文窗口：配置多档，使用时选其中一档；没选过按最大一档，选择按模型保存。
  equal(selectActiveContextWindow(store.getState()), 983040, 'default is the largest window');
  equal(selectContextLimit(store.getState()), 983040, 'page limit follows the largest window');
  await store.dispatch(setCustomModelContext('s1::model-b', 614400));
  equal(selectActiveContextWindow(store.getState()), 614400, 'chosen window is used');
  equal(selectContextLimit(store.getState()), 614400, 'page limit follows the chosen window');
  equal(
    (await storage.get('local', 'customContextChoice')).customContextChoice,
    { 's1::model-b': 614400 },
    'context choice is persisted'
  );
  // 编辑服务把选中的那档去掉后，退回最大一档，不会卡在一个已不存在的值上。
  await store.dispatch(
    saveCustomService({ ...custom, tools: false, thinking: true, contextWindows: [307200] })
  );
  equal(selectActiveContextWindow(store.getState()), 307200, 'removed choice falls back');
  await store.dispatch(saveCustomService({ ...custom, tools: false, thinking: true }));
  await store.dispatch(setCustomModelContext('s1::model-b', 307200));

  // 编辑服务时删掉了当前正在用的模型：选择被清掉，不会指向不存在的模型。
  await store.dispatch(saveCustomService({ ...custom, tools: false, models: ['model-a'] }));
  equal(store.getState().customModel.activeId, null, 'removed active model clears the selection');
  equal(
    (await storage.get('local', 'activeCustomModelId')).activeCustomModelId,
    null,
    'cleared selection is persisted'
  );
  equal(
    store.getState().customModel.contextChoice,
    {},
    'context choice of a removed model is dropped'
  );
  equal(
    (await storage.get('local', 'customContextChoice')).customContextChoice,
    {},
    'dropped context choice is persisted'
  );
  equal(store.getState().customModel.thinkingOff, [], 'switch of a removed model is dropped');
  equal(
    (await storage.get('local', 'customThinkingOff')).customThinkingOff,
    [],
    'dropped switch is persisted'
  );
  await store.dispatch(setActiveCustomModel('s1::model-b'));
  equal(store.getState().customModel.activeId, null, 'cannot select a model that no longer exists');
  await store.dispatch(setActiveCustomModel('s1::model-a'));

  // 删除当前使用的服务：回到 Ollama。
  await store.dispatch(removeCustomService('s1'));
  equal(
    store.getState().customModel.activeId,
    null,
    'removing the active model clears the selection'
  );
  equal(selectSelectedModelKey(store.getState()), 'qwen2.5', 'falls back to the ollama model');
  equal(
    (await storage.get('local', 'activeCustomModelId')).activeCustomModelId,
    null,
    'selection cleared in storage'
  );

  // 切回 Ollama 后请求走 /api/chat。
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '本地', createdAt: 6 }] }));
  script = [
    () =>
      new Response(
        `${JSON.stringify({ message: { role: 'assistant', content: '本地回答' }, done: true, done_reason: 'stop' })}\n`,
        { status: 200 }
      ),
  ];
  const ollamaStart = calls.length;
  await settledAfter('ollama turn', () => withTimeout(runtime.startAssistantTurn()));
  equal(calls[ollamaStart].url, 'http://127.0.0.1:11434/api/chat', 'ollama path is untouched');
  equal(
    store.getState().chat.messages.at(-1)?.model,
    'qwen2.5',
    'ollama message keeps its model name'
  );

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('custom runtime fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  throw error;
});
