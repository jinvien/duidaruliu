import http from 'node:http';

import { forwardLoopback, handleLoopbackProxy, parseLoopbackTarget } from '../dev/loopbackProxy';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

async function main() {
  assert(parseLoopbackTarget('http://127.0.0.1:11434/api/chat')?.port === '11434', 'ipv4 loopback');
  assert(parseLoopbackTarget('http://localhost:9/')?.hostname === 'localhost', 'localhost');
  assert(parseLoopbackTarget('http://[::1]:11434/')?.hostname === '[::1]', 'ipv6 loopback');
  assert(!parseLoopbackTarget('https://example.com/mcp'), 'public host is blocked');
  assert(!parseLoopbackTarget('http://127.0.0.1.example.com/'), 'lookalike host is blocked');
  assert(!parseLoopbackTarget('http://2130706433/'), 'decimal ip is blocked');
  assert(!parseLoopbackTarget('http://user:pass@127.0.0.1/'), 'credentials are blocked');
  assert(!parseLoopbackTarget('not a url'), 'garbage is blocked');

  const seen: { origin?: string; method?: string; body?: string; closed: boolean } = {
    closed: false,
  };
  const target = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      seen.origin = req.headers.origin;
      seen.method = req.method;
      seen.body = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"message":{"content":"a"}}\n');
      res.end('{"done":true}\n');
    });
    req.on('close', () => {
      if (!res.writableEnded) seen.closed = true;
    });
  });
  const port = await listen(target);
  const targetUrl = new URL(`http://127.0.0.1:${port}/api/chat`);

  const streamed = await forwardLoopback({
    target: targetUrl,
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
    body: new TextEncoder().encode('{"model":"mock"}'),
    rewriteOrigin: true,
  });
  assert(streamed.statusCode === 200, 'mock target status');
  assert(streamed.body.toString('utf8').includes('"done":true'), 'mock stream body is forwarded');
  assert(seen.origin === targetUrl.origin, 'rewrite sets Origin to the target origin');
  assert(seen.body === '{"model":"mock"}', 'request body reaches the mock target');

  let closed = false;
  const hanging = http.createServer((req) => {
    req.on('close', () => {
      closed = true;
    });
  });
  const hangPort = await listen(hanging);
  const controller = new AbortController();
  const pending = forwardLoopback({
    target: new URL(`http://127.0.0.1:${hangPort}/api/chat`),
    method: 'POST',
    headers: {},
    body: new TextEncoder().encode('{}'),
    signal: controller.signal,
    rewriteOrigin: false,
  });
  await new Promise((resolve) => hanging.once('request', () => resolve(undefined)));
  controller.abort();
  await pending.then(
    () => assert(false, 'aborted request should not resolve'),
    () => assert(true, 'aborted'),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(closed, 'abort closes the upstream socket');

  const chunked = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write('{"message":{"content":"a"}}\n');
    req.on('close', () => {
      if (!res.writableEnded) res.end();
    });
    setTimeout(() => {
      if (!res.writableEnded) res.end('{"done":true,"done_reason":"stop"}\n');
    }, 40);
  });
  const streamPort = await listen(chunked);
  const proxy = http.createServer((req, res) => handleLoopbackProxy(req, res));
  const proxyPort = await listen(proxy);
  const streamUrl = `http://127.0.0.1:${streamPort}/api/chat`;
  const first = await fetch(
    `http://127.0.0.1:${proxyPort}/__ddrl/proxy?target=${encodeURIComponent(streamUrl)}`,
    { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${proxyPort}` }, body: '{}' },
  );
  assert(first.status === 200, `stream status ${first.status}`);
  const text = await first.text();
  assert(text.includes('"content":"a"') && text.includes('"done":true'), 'ndjson stream completes through the proxy');

  const options = await fetch(
    `http://127.0.0.1:${proxyPort}/__ddrl/proxy?target=${encodeURIComponent(streamUrl)}`,
    {
      method: 'OPTIONS',
      headers: {
        origin: `http://127.0.0.1:${proxyPort}`,
        'access-control-request-headers': 'content-type',
      },
    },
  );
  assert(options.status === 204, 'same-origin preflight is answered locally');

  const blocked = await fetch(
    `http://127.0.0.1:${proxyPort}/__ddrl/proxy?target=${encodeURIComponent('https://example.com/api/chat')}`,
  );
  assert(blocked.status === 400, 'public targets stay blocked');

  let upstreamClosed = false;
  const hang = http.createServer((req) => {
    req.on('close', () => {
      upstreamClosed = true;
    });
  });
  const slowPort = await listen(hang);
  const abort = new AbortController();
  const hangingFetch = fetch(
    `http://127.0.0.1:${proxyPort}/__ddrl/proxy?target=${encodeURIComponent(`http://127.0.0.1:${slowPort}/api/chat`)}`,
    { method: 'POST', body: '{}', signal: abort.signal },
  );
  await new Promise((resolve) => hang.once('request', () => resolve(undefined)));
  abort.abort();
  await hangingFetch.then(
    () => assert(false, 'aborted proxy fetch should fail'),
    () => assert(true, 'proxy fetch aborted'),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(upstreamClosed, 'aborting the browser fetch closes the upstream');

  chunked.close();
  proxy.close();
  hang.close();
  target.close();
  hanging.close();
  target.unref();
  hanging.unref();
  if (failed) {
    console.error(`${failed} loopback proxy assertions failed`);
    process.exit(1);
  }
  console.log('loopback proxy fixtures passed (mock server, not Ollama)');
}

void main();
