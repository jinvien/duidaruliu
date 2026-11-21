/// <reference lib="dom" />

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

type FetchCall = {
  body: { messages?: Array<{ role?: string; content?: string }> };
  signal: AbortSignal | null;
};

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
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

async function main() {
  const { default: store } = await import('../src/store/index.ts');
  const { addMessage, setMessages, updateLastMessage } = await import('../src/store/chatSlice.ts');
  const { setOllamaModelParams, setOllamaUrl } = await import('../src/store/ollamaSlice.ts');
  const runtime = await import('../src/agent/runtime.ts');

  const calls: FetchCall[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? null;
    const body = JSON.parse(String(init?.body ?? '{}')) as FetchCall['body'];
    calls.push({ body, signal });
    if (calls.length === 1) {
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    }
    const line = JSON.stringify({
      message: { role: 'assistant', content: '译好了' },
      done: true,
      done_reason: 'stop',
    });
    return new Response(`${line}\n`, { status: 200 });
  }) as typeof fetch;

  store.dispatch(setOllamaUrl('http://127.0.0.1:11434'));
  store.dispatch(setOllamaModelParams({ model: 'qwen2.5' }));

  store.dispatch(setMessages({ messages: [] }));
  store.dispatch(updateLastMessage('不能写'));
  assert(store.getState().chat.messages.length === 0, 'empty list ignores updateLastMessage');

  store.dispatch(
    setMessages({
      messages: [{ role: 'user', content: '原文', createdAt: 1 }],
    })
  );
  store.dispatch(updateLastMessage('污染'));
  assert(
    store.getState().chat.messages[0]?.content === '原文',
    'user message ignores updateLastMessage'
  );
  store.dispatch(addMessage({ role: 'assistant', content: '', createdAt: 2, model: 'qwen2.5' }));
  store.dispatch(updateLastMessage('回答'));
  assert(store.getState().chat.messages.at(-1)?.content === '回答', 'assistant still accepts text');

  store.dispatch(
    setMessages({
      messages: [{ role: 'user', content: '先问', createdAt: 1 }],
    })
  );
  const firstTurn = runtime.startAssistantTurn();
  await waitFor(() => calls.length === 1 && runtime.agentIsStreaming());
  assert(
    store.getState().chat.responseStatus === 'end',
    'spinner stays off during the first 500ms'
  );
  assert(runtime.resetAgentTranscript() === false, 'new chat cannot reset a live run');
  assert(store.getState().chat.messages.length > 0, 'new chat did not clear the list');

  const loaded = runtime.loadAgentTranscript([{ role: 'user', content: '不该写入', createdAt: 1 }]);
  assert(loaded === false, 'history load no-ops while streaming');
  assert(
    runtime.snapshotAgentTranscript().some((message) => message.text === '先问'),
    'live transcript stays on the current question'
  );
  assert(
    !runtime.snapshotAgentTranscript().some((message) => message.text === '不该写入'),
    'mid-run load did not replace the agent'
  );

  store.dispatch(
    setMessages({
      messages: [
        { role: 'system', content: '翻译系统提示', createdAt: 2 },
        { role: 'user', content: '需要翻译的句子', createdAt: 3 },
      ],
    })
  );
  store.dispatch(updateLastMessage('污染译文'));
  assert(
    store.getState().chat.messages[1]?.content === '需要翻译的句子',
    'replaced user text survives a stale delta'
  );

  const translateTurn = runtime.startAssistantTurn();
  await translateTurn;
  await firstTurn;
  const translated = store.getState().chat.messages;
  assert(translated[1]?.content === '需要翻译的句子', 'translation user text was not overwritten');
  assert(translated.at(-1)?.role === 'assistant', 'translation got an assistant placeholder');
  assert(
    translated.at(-1)?.content === '译好了',
    `translation reply, got ${translated.at(-1)?.content}`
  );
  assert(calls.length === 2, `translation request went out, fetches=${calls.length}`);
  assert(
    calls[1]?.body.messages?.[1]?.content === '需要翻译的句子',
    'second request uses the translation transcript'
  );
  assert(!runtime.agentIsStreaming(), 'translation run finished');

  store.dispatch(
    setMessages({
      messages: [{ role: 'user', content: '再问', createdAt: 4 }],
    })
  );
  calls.length = 0;
  const historyTurn = runtime.startAssistantTurn();
  await waitFor(() => calls.length === 1 && runtime.agentIsStreaming());
  const history = [
    { role: 'user' as const, content: '旧问题', createdAt: 5 },
    { role: 'assistant' as const, content: '历史回答', createdAt: 6, model: 'qwen2.5' },
  ];
  await runtime.settleAgent();
  store.dispatch(setMessages({ messages: history }));
  assert(runtime.loadAgentTranscript(history) === true, 'history loads after the run is idle');
  await historyTurn;
  assert(store.getState().chat.messages[1]?.content === '历史回答', 'history assistant text stays');
  assert(calls.length === 1, 'opening history does not send another request');
  assert(!runtime.agentIsStreaming(), 'history leaves the agent idle');
  const transcript = runtime.snapshotAgentTranscript();
  assert(
    transcript.at(-1)?.role === 'assistant' && transcript.at(-1)?.text === '历史回答',
    'agent transcript matches history'
  );

  await runtime.settleAgent();
  runtime.resetAgentTranscript();
  store.dispatch(setMessages({ messages: [] }));

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('agent runtime lifecycle passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
