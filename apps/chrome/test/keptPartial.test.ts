/// <reference lib="dom" />
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

function partialThen(signal: AbortSignal | null, chunks: unknown[]) {
  const bytes = new TextEncoder().encode(ndjson(chunks));
  return new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(bytes);
        await new Promise<void>((resolve) => {
          if (!signal || signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      },
    })
  );
}

async function main() {
  const { default: store } = await import('../src/store/index.ts');
  const { addMessage, setMessages } = await import('../src/store/chatSlice.ts');
  const { setOllamaModelParams, setOllamaUrl } = await import('../src/store/ollamaSlice.ts');
  const { normalizeConversation } = await import('../src/store/historySlice.ts');
  const { answerModelName, groupChatBlocks, lastAnswerModel } = await import(
    '../src/utils/chatView.ts'
  );
  const runtime = await import('../src/agent/runtime.ts');

  const reported: unknown[] = [];
  runtime.setChatErrorReporter((error) => {
    reported.push(error);
  });

  store.dispatch(setOllamaUrl('http://127.0.0.1:11434'));
  store.dispatch(setOllamaModelParams({ model: 'qwen2.5' }));

  type Mode = 'abort' | 'fail' | 'empty' | 'tool' | 'ok';
  let mode: Mode = 'abort';
  let toolCalls = 0;
  const bodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    bodies.push(body);
    const signal = init?.signal ?? null;
    if (mode === 'fail') {
      return new Response(
        ndjson([
          { message: { role: 'assistant', content: '一半', thinking: '想过' }, done: false },
          { error: 'model not found' },
        ]),
        { status: 200 }
      );
    }
    if (mode === 'empty') {
      return new Response(JSON.stringify({ error: 'model not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (mode === 'ok') {
      return new Response(
        ndjson([
          { message: { role: 'assistant', content: '后一句' }, done: true, done_reason: 'stop' },
        ]),
        { status: 200 }
      );
    }
    if (mode === 'tool') {
      toolCalls += 1;
      if (toolCalls === 1) {
        return new Response(
          ndjson([
            {
              message: {
                role: 'assistant',
                content: '先说',
                tool_calls: [{ function: { name: 'echo', arguments: { q: 'hi' } } }],
              },
              done: true,
              done_reason: 'stop',
            },
          ]),
          { status: 200 }
        );
      }
      return partialThen(signal, [
        { message: { role: 'assistant', content: '跟进', thinking: '再想' }, done: false },
      ]);
    }
    return partialThen(signal, [
      { message: { role: 'assistant', content: '部分回答', thinking: '在想' }, done: false },
    ]);
  }) as typeof fetch;

  const rendered = () => {
    const { messages, responseStatus, pendingTool } = store.getState().chat;
    const blocks = groupChatBlocks(messages, 'qwen2.5');
    return blocks.flatMap((block, index) => {
      if (block.kind !== 'assistant') return [];
      const isLast = index === blocks.length - 1;
      const waiting = isLast && responseStatus === 'waiting';
      if (block.segments.length === 0 && !(pendingTool && isLast) && !waiting) return [];
      return [block];
    });
  };

  const reset = async () => {
    await runtime.settleAgent();
    runtime.setAgentTools([]);
    runtime.resetAgentTranscript();
    store.dispatch(setMessages({ messages: [] }));
    store.dispatch(setOllamaModelParams({ model: 'qwen2.5' }));
    reported.length = 0;
    bodies.length = 0;
    toolCalls = 0;
  };

  {
    await reset();
    mode = 'abort';
    store.dispatch(setMessages({ messages: [{ role: 'user', content: '停一下', createdAt: 1 }] }));
    const turn = runtime.startAssistantTurn();
    await waitFor(() => store.getState().chat.messages.at(-1)?.content === '部分回答');
    runtime.abortAgent();
    await withTimeout(turn);

    const messages = store.getState().chat.messages;
    assert(messages.at(-1)?.content === '部分回答', 'stop keeps the partial answer');
    assert(messages.at(-1)?.thinking === '在想', 'stop keeps streamed thinking');
    assert(store.getState().chat.responseStatus === 'end', 'stop ends the response');
    assert(!runtime.agentIsStreaming(), 'stop leaves the agent idle');
    const shown = rendered();
    assert(
      shown.length === 1 && shown[0]?.copyText === '部分回答',
      'the answer box stays copyable'
    );
    assert(
      reported.length > 0 &&
        reported.every((error) => error instanceof Error && error.name === 'AbortError'),
      'stop still reports AbortError and does not become a request failure'
    );

    mode = 'ok';
    reported.length = 0;
    bodies.length = 0;
    store.dispatch(addMessage({ role: 'user', content: '再问', createdAt: 2 }));
    await withTimeout(runtime.startAssistantTurn());
    const body = bodies.at(-1);
    const wire = (body?.messages ?? []) as Array<{ role?: string; content?: string }>;
    const assistants = wire.filter((message) => message.role === 'assistant');
    assert(
      body?.model === 'qwen2.5',
      `next send keeps the current model, got ${String(body?.model)}`
    );
    assert(
      assistants.length === 1 && assistants[0]?.content === '部分回答',
      'next send keeps one partial, not an empty cancel'
    );
    assert(!JSON.stringify(body).includes('unknown'), 'next send does not request unknown');
    assert(
      store.getState().chat.messages.at(-1)?.content === '后一句',
      'the new reply is its own message'
    );

    const next = [
      { role: 'user' as const, content: '另一通', createdAt: 3 },
      { role: 'assistant' as const, content: '保持', createdAt: 4, model: 'qwen2.5' },
    ];
    await runtime.settleAgent();
    store.dispatch(setMessages({ messages: next }));
    assert(runtime.loadAgentTranscript(next), 'the next conversation loads after stop');
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert(
      store.getState().chat.messages[1]?.content === '保持',
      'cancel is not written into the next conversation'
    );
    assert(
      runtime.snapshotAgentTranscript().at(-1)?.text === '保持',
      'agent transcript follows the next conversation'
    );
    assert(
      store.getState().ollama.ollamaModelParams.model === 'qwen2.5',
      'switching chats keeps the selected model'
    );
  }

  {
    await reset();
    mode = 'abort';
    store.dispatch(setMessages({ messages: [{ role: 'user', content: '还在流', createdAt: 1 }] }));
    const turn = runtime.startAssistantTurn();
    await waitFor(() => store.getState().chat.messages.at(-1)?.content === '部分回答');
    await withTimeout(runtime.settleAgent());
    await withTimeout(turn);
    assert(
      store.getState().chat.messages.at(-1)?.content === '部分回答',
      'settling a live reply does not clear the partial'
    );
    const next = [
      { role: 'user' as const, content: '下一通', createdAt: 2 },
      { role: 'assistant' as const, content: '别覆盖', createdAt: 3, model: 'llama3.1' },
    ];
    store.dispatch(setMessages({ messages: next }));
    assert(runtime.loadAgentTranscript(next), 'history can replace a settled run');
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert(
      store.getState().chat.messages[1]?.content === '别覆盖',
      'a settled abort stays out of the opened chat'
    );
    assert(
      !runtime.snapshotAgentTranscript().some((message) => message.text.includes('部分回答')),
      'the opened transcript does not contain the cancelled partial'
    );
    assert(!runtime.agentIsStreaming(), 'settle stops the agent');
  }

  {
    await reset();
    mode = 'fail';
    store.dispatch(setMessages({ messages: [{ role: 'user', content: '会失败', createdAt: 1 }] }));
    await withTimeout(runtime.startAssistantTurn());
    const messages = store.getState().chat.messages;
    assert(messages.at(-1)?.content === '一半', 'a failed request keeps the partial answer');
    assert(messages.at(-1)?.thinking === '想过', 'a failed request keeps streamed thinking');
    const shown = rendered();
    assert(shown.length === 1 && shown[0]?.copyText === '一半', 'a failed partial stays copyable');
    assert(store.getState().chat.responseStatus === 'end', 'failure ends the response');
    assert(
      reported.some(
        (error) =>
          error instanceof Error &&
          error.name !== 'AbortError' &&
          error.message === 'model not found'
      ),
      'failure still reports the request error'
    );
  }

  {
    await reset();
    mode = 'empty';
    store.dispatch(
      setMessages({ messages: [{ role: 'user', content: '马上失败', createdAt: 1 }] })
    );
    await withTimeout(runtime.startAssistantTurn());
    assert(rendered().length === 0, 'a failure before any token does not leave an answer box');
    assert(store.getState().chat.messages.at(-1)?.content === '', 'the placeholder stays empty');
    assert(store.getState().chat.responseStatus === 'end', 'an immediate failure still ends');
    assert(
      reported.some((error) => error instanceof Error && error.name !== 'AbortError'),
      'an immediate failure is still reported'
    );
  }

  {
    await reset();
    mode = 'tool';
    runtime.setAgentTools([
      {
        name: 'echo',
        label: '回声',
        description: 'Echo',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
        execute: async () => ({ content: [{ type: 'text', text: '工具结果' }], details: {} }),
      },
    ]);
    store.dispatch(setMessages({ messages: [{ role: 'user', content: '用工具', createdAt: 1 }] }));
    const turn = runtime.startAssistantTurn();
    await waitFor(() => runtime.getPendingToolApproval()?.id === 'echo');
    runtime.decideToolApproval('once');
    await waitFor(() => store.getState().chat.messages.at(-1)?.content === '跟进');
    runtime.abortAgent();
    await withTimeout(turn);

    const messages = store.getState().chat.messages;
    assert(
      messages.map((message) => message.role).join(',') === 'user,assistant,tool,assistant',
      `follow-up stays a separate message, got ${messages.map((message) => message.role).join(',')}`
    );
    assert(messages[1]?.content === '先说', 'the tool answer is not cleared');
    assert(messages[3]?.content === '跟进', 'abort does not clear the follow-up');
    assert(messages[3]?.thinking === '再想', 'abort does not clear follow-up thinking');
    assert(
      messages[1]?.model === 'qwen2.5' && messages[3]?.model === 'qwen2.5',
      'new messages do not store unknown'
    );
    const shown = rendered();
    assert(
      shown.length === 1 && shown[0]?.copyText === '先说\n\n跟进',
      'copy still contains only the answers'
    );
    assert(!shown[0]?.copyText.includes('工具结果'), 'copy still omits the tool result');
    assert(store.getState().chat.pendingTool === null, 'abort clears the running tool');
    assert(!runtime.agentIsStreaming(), 'abort stops the tool follow-up');
  }

  {
    await reset();
    const stored = {
      lastModel: 'unknown',
      lastUpdatedAt: 5,
      messages: [
        { role: 'user', content: '旧问题', createdAt: 1 },
        { role: 'assistant', content: '旧回答', createdAt: 2, model: 'qwen2.5' },
        { role: 'assistant', content: '旧跟进', createdAt: 3, model: 'unknown' },
      ],
    };
    const conversation = normalizeConversation(stored);
    assert(conversation?.lastModel === 'unknown', 'reading history does not rewrite lastModel');
    assert(
      conversation?.messages[2]?.model === 'unknown',
      'reading history does not rewrite the follow-up model'
    );
    assert(
      conversation?.messages[1]?.model === 'qwen2.5',
      'a stored real model name stays on the message'
    );
    assert(
      lastAnswerModel(conversation?.messages ?? [], conversation?.lastModel) === 'qwen2.5',
      'the history tag uses the real model'
    );
    const current = store.getState().ollama.ollamaModelParams;
    const restored = answerModelName(conversation?.lastModel);
    if (restored) store.dispatch(setOllamaModelParams({ ...current, model: restored }));
    store.dispatch(setMessages({ messages: conversation?.messages ?? [] }));
    assert(runtime.loadAgentTranscript(conversation?.messages ?? []), 'old history loads');
    assert(
      store.getState().ollama.ollamaModelParams.model === 'qwen2.5',
      'opening unknown history keeps the selector'
    );

    mode = 'ok';
    bodies.length = 0;
    store.dispatch(addMessage({ role: 'user', content: '接着问', createdAt: 6 }));
    await withTimeout(runtime.startAssistantTurn());
    const body = bodies.at(-1);
    assert(
      body?.model === 'qwen2.5',
      `send after old history uses the current model, got ${String(body?.model)}`
    );
    assert(
      !JSON.stringify(body).includes('"unknown"'),
      'send after old history does not request unknown'
    );

    const real = normalizeConversation({
      lastModel: 'llama3.1',
      lastUpdatedAt: 7,
      messages: [{ role: 'assistant', content: '实名回答', createdAt: 7, model: 'llama3.1' }],
    });
    assert(
      real?.lastModel === 'llama3.1' && real.messages[0]?.model === 'llama3.1',
      'a real lastModel is left as stored'
    );
    const restoredReal = answerModelName(real?.lastModel);
    if (restoredReal) {
      store.dispatch(
        setOllamaModelParams({ ...store.getState().ollama.ollamaModelParams, model: restoredReal })
      );
    }
    assert(
      store.getState().ollama.ollamaModelParams.model === 'llama3.1',
      'a real history model still restores'
    );
  }

  await reset();
  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('partial reply and unknown history model passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
