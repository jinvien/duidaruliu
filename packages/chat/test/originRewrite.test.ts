import { requestNeedsOriginRewrite } from '../src/mcp/origin';

import type { McpServerRecord } from '../src/mcp/types';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function server(partial: Partial<McpServerRecord> & { name: string; url: string }): McpServerRecord {
  return {
    headers: [],
    enabled: true,
    timeout: 30,
    rewriteOrigin: false,
    ...partial,
  };
}

function main() {
  const ollama = 'http://127.0.0.1:11434';
  const local = server({
    name: 'local',
    url: 'http://localhost:3001/mcp',
    rewriteOrigin: true,
  });
  const remote = server({
    name: 'remote',
    url: 'https://example.com/mcp',
    rewriteOrigin: false,
  });
  const skipped = server({
    name: 'off',
    url: 'http://127.0.0.1:4000/mcp',
    rewriteOrigin: false,
  });

  assert(
    requestNeedsOriginRewrite(`${ollama}/api/chat`, ollama, [remote]),
    'ollama origin is always rewritten',
  );
  assert(
    !requestNeedsOriginRewrite('http://127.0.0.1:9/api/chat', ollama, []),
    'another port on the same host is not the ollama rule',
  );
  assert(
    requestNeedsOriginRewrite('http://localhost:3001/mcp', ollama, [local, remote, skipped]),
    'enabled localhost MCP with rewriteOrigin is rewritten',
  );
  assert(
    !requestNeedsOriginRewrite('https://example.com/mcp', ollama, [local, remote]),
    'remote MCP without rewriteOrigin is left alone',
  );
  assert(
    !requestNeedsOriginRewrite('http://127.0.0.1:4000/mcp', ollama, [skipped]),
    'rewriteOrigin false does not rewrite a loopback MCP',
  );

  if (failed) {
    console.error(`${failed} origin rewrite assertions failed`);
    process.exit(1);
  }
  console.log('origin rewrite fixtures passed');
}

main();
