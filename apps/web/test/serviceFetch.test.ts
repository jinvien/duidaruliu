import { createWebServiceFetch } from '../src/dev/serviceFetch';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

async function main() {
  const calls: Array<{ url: string; method?: string; rewrite: boolean; aborted: boolean; body?: string }> = [];
  const base: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method,
      rewrite: headers.get('x-ddrl-rewrite-origin') === '1',
      aborted: init?.signal?.aborted === true,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response('ok');
  };

  const early = createWebServiceFetch(() => ({ ollamaUrl: '', servers: [] }), base);
  const signal = new AbortController();
  signal.abort();
  await early('http://127.0.0.1:11434/api/tags', { signal: signal.signal });
  assert(calls[0]?.url.startsWith('/__ddrl/proxy?target='), 'loopback tags go through the dev proxy');
  assert(decodeURIComponent(calls[0]?.url ?? '').includes('http://127.0.0.1:11434/api/tags'), 'target is preserved');
  assert(calls[0]?.rewrite === true, 'ollama origin is rewritten before settings land in the store');
  assert(calls[0]?.aborted === true, 'abort signal is forwarded');

  await early('https://example.com/mcp');
  assert(calls[1]?.url === 'https://example.com/mcp', 'public targets are not proxied');

  const settled = createWebServiceFetch(
    () => ({ ollamaUrl: 'http://127.0.0.1:11434', servers: [] }),
    base,
  );
  await settled('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"model":"mock"}',
  });
  assert(calls[2]?.method === 'POST', 'chat method is preserved');
  assert(calls[2]?.body === '{"model":"mock"}', 'chat body is preserved');
  assert(calls[2]?.rewrite === true, 'configured ollama origin is rewritten');

  await settled('http://127.0.0.1:9999/mcp');
  assert(calls[3]?.rewrite === false, 'another loopback port is not rewritten just because it is local');

  if (failed) {
    console.error(`${failed} service fetch assertions failed`);
    process.exit(1);
  }
  console.log('service fetch fixtures passed (mock fetch, not Ollama)');
}

void main();
