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
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    runtime: {
      getURL: (path: string) => path,
    },
  },
  configurable: true,
});

installChatHost({ storage: createMemoryStorage(), openSettings() {} });

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
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
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() - started > ms) {
        reject(new Error('timed out'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function ndjson(lines: unknown[]) {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

async function main() {
  const { default: store } = await import('../src/store/index.ts');
  const { addMessage, setMessages } = await import('../src/store/chatSlice.ts');
  const { setOllamaModelParams, setOllamaUrl } = await import('../src/store/ollamaSlice.ts');
  const { replaceConversationForTranslate } = await import(
    '../src/pages/chat/translateConversation.ts'
  );
  const runtime = await import('../src/agent/runtime.ts');

  store.dispatch(setOllamaUrl('http://127.0.0.1:11434'));
  store.dispatch(setOllamaModelParams({ model: 'qwen2.5' }));

  const bodies: Array<{ messages?: Array<Record<string, unknown>> }> = [];
  let calls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as (typeof bodies)[number];
    bodies.push(body);
    if (calls === 1) {
      return new Response(
        ndjson([
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'echo', arguments: { q: 'hi' } } }],
            },
            done: true,
            done_reason: 'stop',
          },
        ]),
        { status: 200 }
      );
    }
    if (calls === 2) {
      return new Response(
        ndjson([
          {
            message: { role: 'assistant', content: '最终回答', thinking: '想一下' },
            done: true,
            done_reason: 'stop',
          },
        ]),
        { status: 200 }
      );
    }
    return new Response(
      ndjson([{ message: { role: 'assistant', content: '好' }, done: true, done_reason: 'stop' }]),
      { status: 200 }
    );
  }) as typeof fetch;

  runtime.setAgentTools([
    {
      name: 'echo',
      label: '回声',
      description: 'Echo',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async () => ({ content: [{ type: 'text', text: '好' }], details: {} }),
    },
  ]);

  store.dispatch(setMessages({ messages: [{ role: 'user', content: '查', createdAt: 1 }] }));
  const toolTurn = runtime.startAssistantTurn();
  await waitFor(() => runtime.getPendingToolApproval()?.id === 'echo');
  runtime.decideToolApproval('session');
  await withTimeout(toolTurn);
  const afterTool = store.getState().chat.messages;
  assert(
    afterTool.map((message) => message.role).join(',') === 'user,assistant,tool,assistant',
    `follow-up assistant is a new message, got ${afterTool.map((message) => message.role).join(',')}`
  );
  assert(
    !afterTool[1]?.content.includes('最终回答'),
    'answer is not written onto the tool-call assistant'
  );
  assert(
    afterTool[2]?.role === 'tool' && afterTool[2].content === '好',
    'tool bubble keeps the result'
  );
  assert(afterTool[2]?.toolName === 'echo', 'wire name stays on the tool message');
  assert(afterTool[2]?.toolDisplayName === '回声', 'bubble stores the display name');
  assert(afterTool[3]?.content === '最终回答', `follow-up text, got ${afterTool[3]?.content}`);
  assert(afterTool[3]?.thinking === '想一下', 'thinking is stored on its own field');
  assert(!afterTool[3]?.content.includes('<think>'), 'content is not a second copy of thinking');
  assert(!afterTool[3]?.content.includes('想一下'), 'thinking text stays out of content');
  assert(store.getState().chat.pendingTool === null, 'finished tool clears the running bubble');
  assert(runtime.isToolAllowedForSession('echo'), 'a later turn keeps session allow');

  store.dispatch(addMessage({ role: 'user', content: '继续', createdAt: 5 }));
  await withTimeout(runtime.startAssistantTurn());
  const replay = bodies
    .at(-1)
    ?.messages?.find((message) => message.role === 'assistant' && message.content === '最终回答');
  assert(replay?.thinking === '想一下', 'replay sends thinking once, on the thinking field');
  assert(!String(replay?.content).includes('想一下'), 'replay content does not repeat thinking');
  assert(
    runtime.isToolAllowedForSession('echo'),
    'sending another message does not clear session allow'
  );

  await replaceConversationForTranslate({
    dispatch: store.dispatch,
    messages: [
      { role: 'system', content: '翻译系统提示', createdAt: 6 },
      { role: 'user', content: '句子', createdAt: 7 },
    ],
    saveCurrent: false,
    send: async () => {},
  });
  assert(!runtime.isToolAllowedForSession('echo'), 'translate drops session allow');
  assert(
    store.getState().chat.messages[1]?.content === '句子',
    'translate replaces the transcript'
  );

  runtime.setAgentTools([
    {
      name: 'hang',
      label: '挂起',
      description: 'Hang',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      execute: (_id, _args, signal) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        }),
    },
  ]);
  let hangCalls = 0;
  globalThis.fetch = (async () => {
    hangCalls += 1;
    if (hangCalls > 1) {
      return new Response(
        ndjson([
          { message: { role: 'assistant', content: '停' }, done: true, done_reason: 'stop' },
        ]),
        { status: 200 }
      );
    }
    return new Response(
      ndjson([
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'hang', arguments: { q: 'x' } } }],
          },
          done: true,
          done_reason: 'stop',
        },
      ]),
      { status: 200 }
    );
  }) as typeof fetch;

  store.dispatch(setMessages({ messages: [{ role: 'user', content: '等', createdAt: 8 }] }));
  const hanging = runtime.startAssistantTurn();
  await waitFor(
    () => store.getState().chat.pendingTool !== null || runtime.getPendingToolApproval() !== null
  );
  await withTimeout(runtime.settleAgent());
  await withTimeout(hanging);
  assert(store.getState().chat.pendingTool === null, 'settle clears the running tool bubble');
  assert(runtime.getPendingToolApproval() === null, 'settle clears the approval card');
  assert(store.getState().chat.responseStatus === 'end', 'settle ends the response');
  assert(!runtime.agentIsStreaming(), 'aborted tool run is idle');

  runtime.setAgentTools([]);
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [] }));

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('stage 3 runtime fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
