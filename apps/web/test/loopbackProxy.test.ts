import http from 'node:http';

import { forwardLoopback, parseLoopbackTarget } from '../dev/loopbackProxy';

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
