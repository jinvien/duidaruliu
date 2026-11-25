/// <reference lib="dom" />
import { createMemoryStorage, installChatHost } from '../src/host';
import { composerStopVisible } from '../src/pages/chat/composer';

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

function textResponse(content: string, done = true) {
  const lines: unknown[] = [{ message: { role: 'assistant', content } }];
  if (done) lines.push({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' });
  return new Response(ndjson(lines), { status: 200 });
}

async function settled(runtime: typeof import('../src/agent/runtime')) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(!runtime.agentIsStreaming(), 'run is idle after it settles');
}

async function main() {
  const { default: store } = await import('../src/store/index.ts');
  const { setMessages } = await import('../src/store/chatSlice.ts');
  const { checkOllamaStatus, setOllamaModelParams, setOllamaUrl } = await import(
    '../src/store/ollamaSlice.ts'
  );
  const runtime = await import('../src/agent/runtime.ts');

  store.dispatch(setOllamaUrl('http://127.0.0.1:11434'));
  store.dispatch(setOllamaModelParams({ model: 'mock' }));
  runtime.setAgentTools([]);
  runtime.resetAgentTranscript();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) {
      return Response.json({ models: [{ name: 'mock' }] });
    }
    return new Response('Ollama is running', { status: 200 });
  }) as typeof fetch;
  await store.dispatch(checkOllamaStatus('http://127.0.0.1:11434'));
  assert(store.getState().ollama.ollamaIsRunning, 'mock root marks the service reachable');
  assert(store.getState().ollama.serviceError === '', 'a successful check clears the error');

  globalThis.fetch = (async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
  }) as typeof fetch;
  await store.dispatch(checkOllamaStatus('http://127.0.0.1:11434'));
  assert(!store.getState().ollama.ollamaIsRunning, 'a refused connection is not running');
  assert(
    store.getState().ollama.serviceError.includes('ECONNREFUSED'),
    `error detail is kept, got ${store.getState().ollama.serviceError}`,
  );

  globalThis.fetch = (async () => textResponse('你好')) as typeof fetch;
  store.dispatch(setMessages({ messages: [{ role: 'user', content: 'hi', createdAt: 1 }] }));
  await withTimeout(runtime.startAssistantTurn());
  await settled(runtime);
  assert(store.getState().chat.responseStatus === 'end', 'done ends the turn');
  assert(!composerStopVisible(store.getState().chat.responseStatus), 'stop hides after done');
  assert(store.getState().chat.messages.at(-1)?.content.includes('你好'), 'done keeps the answer');

  globalThis.fetch = (async () => textResponse('没有协议结束', false)) as typeof fetch;
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '缺 done', createdAt: 2 }] }));
  await withTimeout(runtime.startAssistantTurn());
  await settled(runtime);
  assert(store.getState().chat.responseStatus === 'end', 'a closed body without done still ends');
  assert(
    store.getState().chat.messages.at(-1)?.content.includes('没有协议结束'),
    'text before a missing done is kept',
  );
  assert(!composerStopVisible('end'), 'stop stays hidden when the protocol omitted done');

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'model not found' }), { status: 404 })) as typeof fetch;
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '坏', createdAt: 3 }] }));
  await withTimeout(runtime.startAssistantTurn());
  await settled(runtime);
  assert(store.getState().chat.responseStatus === 'end', 'http failure ends the turn');
  assert(!composerStopVisible(store.getState().chat.responseStatus), 'stop hides after failure');

  let hangStops = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('{"message":{"role":"assistant","content":"已经出来"}}\n'),
          );
          const fail = () => {
            controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          };
          if (init?.signal?.aborted) fail();
          else init?.signal?.addEventListener('abort', fail, { once: true });
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  store.dispatch(setMessages({ messages: [{ role: 'user', content: '挂', createdAt: 4 }] }));
  const hanging = runtime.startAssistantTurn();
  await waitFor(() =>
    (store.getState().chat.messages.at(-1)?.content ?? '').includes('已经出来'),
  );
  assert(composerStopVisible(store.getState().chat.responseStatus), 'stop is available while the body is open');
  runtime.abortAgent();
  hangStops += 1;
  runtime.abortAgent();
  hangStops += 1;
  await withTimeout(hanging);
  await settled(runtime);
  assert(hangStops === 2, 'a second stop does not throw');
  assert(store.getState().chat.responseStatus === 'end', 'abort ends a hung stream');
  assert(
    store.getState().chat.messages.at(-1)?.content.includes('已经出来'),
    'abort keeps the text that already arrived',
  );
  assert(!composerStopVisible(store.getState().chat.responseStatus), 'stop hides after abort');

  globalThis.fetch = (async () => textResponse('下一轮')) as typeof fetch;
  store.dispatch(
    setMessages({
      messages: [
        { role: 'user', content: '挂', createdAt: 4 },
        { role: 'assistant', content: '已经出来', createdAt: 5 },
        { role: 'user', content: '再来', createdAt: 6 },
      ],
    }),
  );
  await withTimeout(runtime.startAssistantTurn());
  await settled(runtime);
  assert(store.getState().chat.messages.at(-1)?.content.includes('下一轮'), 'the next turn still runs');
  assert(store.getState().chat.responseStatus === 'end', 'the next turn ends');

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('turn status fixtures passed (mock stream, not Ollama)');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
