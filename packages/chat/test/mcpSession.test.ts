/// <reference lib="dom" />
import { streamOllamaChat } from '../src/agent/ollamaStream';
import {
  mcpOriginRuleIds,
  planMcpOriginRules,
  planOllamaOriginRule,
  MCP_ORIGIN_RULE_ID_START,
  OLLAMA_ORIGIN_RULE_PRIORITY,
} from '../src/mcp/origin';
import { closeMcpSessions, getMcpRuntime, syncMcpSessions } from '../src/mcp/session';
import { mcpOriginRewriteDefault, type McpServerRecord } from '../src/mcp/types';

import type { Api, Model } from '@earendil-works/pi-ai';

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

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function server(
  partial: Partial<McpServerRecord> & Pick<McpServerRecord, 'name' | 'url'>
): McpServerRecord {
  return {
    headers: [],
    enabled: true,
    timeout: 30,
    rewriteOrigin: mcpOriginRewriteDefault(partial.url),
    ...partial,
  };
}

function jsonResponse(body: unknown, status = 200, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

async function main() {
  assert(mcpOriginRewriteDefault('http://127.0.0.1:8080/mcp') === true, 'loopback rewrites origin');
  assert(
    mcpOriginRewriteDefault('http://localhost:8080/mcp') === true,
    'localhost rewrites origin'
  );
  assert(mcpOriginRewriteDefault('https://example.com/mcp') === false, 'remote https does not');

  const extensionId = 'abcdefghijklmnopqrstuvwxyzabcdef';
  const ollama = planOllamaOriginRule('http://127.0.0.1:11434');
  assert(
    ollama?.id === 1 && ollama.priority === OLLAMA_ORIGIN_RULE_PRIORITY,
    'ollama stays rule 1'
  );
  assert(
    ollama?.action.requestHeaders[0]?.value === 'http://127.0.0.1:11434',
    'ollama origin includes its port'
  );
  const ollamaPattern = new RegExp(ollama?.condition.regexFilter ?? '$^');
  assert(ollamaPattern.test('http://127.0.0.1:11434/api/chat'), 'ollama rule matches its own port');
  assert(
    !ollamaPattern.test('http://127.0.0.1:8080/mcp'),
    'ollama rule skips other loopback ports'
  );

  const rules = planMcpOriginRules(
    [
      server({ name: 'local', url: 'http://127.0.0.1:8080/mcp', rewriteOrigin: true }),
      server({ name: 'same', url: 'http://127.0.0.1:8080/other', rewriteOrigin: true }),
      server({ name: 'remote', url: 'https://example.com/mcp', rewriteOrigin: false }),
      server({
        name: 'forced',
        url: 'https://tools.example/mcp',
        rewriteOrigin: true,
        enabled: true,
      }),
      server({ name: 'off', url: 'http://localhost:9/mcp', rewriteOrigin: true, enabled: false }),
    ],
    extensionId
  );
  assert(rules.length === 2, `one rule per origin, got ${rules.length}`);
  assert(
    rules.every((rule) => rule.id >= MCP_ORIGIN_RULE_ID_START),
    'mcp rules start at 100'
  );
  assert(!rules.some((rule) => rule.id === 1), 'ollama keeps rule 1');
  assert(rules[0]?.action.requestHeaders[0]?.value === 'http://127.0.0.1:8080', 'local origin');
  assert(
    rules[1]?.action.requestHeaders[0]?.value === 'https://tools.example',
    'forced remote origin'
  );
  assert(
    rules.every((rule) => rule.priority > OLLAMA_ORIGIN_RULE_PRIORITY),
    'mcp origin rules outrank ollama'
  );
  assert(
    rules.every((rule) => rule.condition.initiatorDomains?.[0] === extensionId),
    'mcp origin rules are limited to this extension'
  );
  assert(
    mcpOriginRuleIds([1, 99, 100, 101]).join(',') === '100,101',
    'closing the panel removes only the mcp rule ids'
  );
  assert(planMcpOriginRules([], extensionId).length === 0, 'cleanup adds no mcp rules');

  const seen: Record<string, string[]> = { a: [], b: [], c: [] };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const key = url.includes(':8081') ? 'b' : url.includes(':8082') ? 'c' : 'a';
    if (method === 'GET') return new Response(null, { status: 405 });
    if (method === 'DELETE') return new Response(null, { status: 200 });
    const message = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string };
    seen[key].push(message.method ?? method);
    if (key === 'b') return new Response('down', { status: 500 });
    if (key === 'c') return new Response('nope', { status: 401 });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'initialize') {
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'fake', version: '1.0.0' },
          },
        },
        200,
        { 'mcp-session-id': 'session-a' }
      );
    }
    if (message.method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object' } }],
        },
      });
    }
    return new Response('unexpected', { status: 500 });
  };

  await syncMcpSessions(
    [
      server({ name: 'docs', url: 'http://127.0.0.1:8080/mcp' }),
      server({ name: 'broken', url: 'http://127.0.0.1:8081/mcp' }),
      server({ name: 'locked', url: 'http://127.0.0.1:8082/mcp' }),
      server({ name: 'local-only', url: '', command: 'npx' }),
    ],
    fetchImpl
  );

  const runtime = getMcpRuntime();
  const docs = runtime.find((item) => item.name === 'docs');
  const broken = runtime.find((item) => item.name === 'broken');
  const locked = runtime.find((item) => item.name === 'locked');
  const stdio = runtime.find((item) => item.name === 'local-only');
  assert(
    seen.a.includes('initialize') && seen.a.includes('tools/list'),
    `docs methods ${seen.a.join(',')}`
  );
  assert(docs?.status === 'connected' && docs.tools[0]?.name === 'echo', 'docs tools listed');
  assert(broken?.status === 'error', `broken server stays failed, got ${broken?.status}`);
  assert(locked?.status === 'auth', `401 is auth, got ${locked?.status}`);
  assert(stdio?.status === 'stdio', 'stdio is not connected');

  let chatBody: Record<string, unknown> | undefined;
  const stream = streamOllamaChat(
    model,
    { messages: [{ role: 'user', content: '你好', timestamp: 1 }] },
    undefined,
    {
      url: 'http://127.0.0.1:11434/api/chat',
      modelParams: { model: 'qwen2.5', keep_alive: 300 },
      includeImages: false,
      lang: 'zh-CN',
      translateSystemPrompt: '翻译系统提示',
      translatePostfix: '请将上方内容翻译成',
      fetchImpl: async (_input, init) => {
        chatBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return new Response(
          `${JSON.stringify({ message: { role: 'assistant', content: '好' }, done: true, done_reason: 'stop' })}\n`
        );
      },
    }
  );
  const events = [];
  for await (const event of stream) events.push(event);
  assert(
    events.some((event) => event.type === 'done'),
    'chat still completes'
  );
  assert(chatBody?.model === 'qwen2.5', 'chat still posts the ollama model');
  assert(!chatBody || !('tools' in chatBody), 'chat body has no tools field');
  assert(!chatBody || !('think' in chatBody), 'chat body has no think field');
  const messages = chatBody?.messages as Array<{ role?: string }> | undefined;
  assert(messages?.[0]?.role === 'user', 'chat messages unchanged');

  let releaseSlow = () => {};
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let slowStarted = false;
  const deleted: string[] = [];
  const overlapFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET') return new Response(null, { status: 405 });
    if (method === 'DELETE') {
      deleted.push(url);
      return new Response(null, { status: 200 });
    }
    const message = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string };
    if (url.includes(':9001') && message.method === 'initialize') {
      slowStarted = true;
      await slowGate;
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'initialize') {
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'overlap', version: '1.0.0' },
          },
        },
        200,
        { 'mcp-session-id': 'overlap' }
      );
    }
    if (message.method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: [{ name: 'later', inputSchema: { type: 'object' } }] },
      });
    }
    return new Response('unexpected', { status: 500 });
  };

  const slowTurn = syncMcpSessions(
    [server({ name: 'slow', url: 'http://127.0.0.1:9001/mcp' })],
    overlapFetch
  );
  const waitStarted = Date.now();
  while (!slowStarted) {
    if (Date.now() - waitStarted > 2000) throw new Error('slow sync did not start');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const fastTurn = syncMcpSessions(
    [server({ name: 'fast', url: 'http://127.0.0.1:9002/mcp' })],
    overlapFetch
  );
  assert(
    !getMcpRuntime().some((item) => item.name === 'fast'),
    'a later sync waits until the current one finishes'
  );
  releaseSlow();
  await slowTurn;
  await fastTurn;
  const overlapped = getMcpRuntime();
  assert(
    overlapped.length === 1 &&
      overlapped[0]?.name === 'fast' &&
      overlapped[0].status === 'connected' &&
      overlapped[0].tools[0]?.name === 'later',
    'the later sync keeps its client'
  );
  assert(
    deleted.some((url) => url.includes(':9001')),
    'the earlier overlapping client was closed'
  );

  await closeMcpSessions();
  assert(
    deleted.some((url) => url.includes(':9002')),
    'closing the panel closes the remaining client'
  );
  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('mcp session fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
