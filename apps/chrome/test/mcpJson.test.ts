import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp';

import { parseMcpServersDocument, serversToMcpDocument } from '../src/mcp/jsonConfig';
import { normalizeStoredMcpServers } from '../src/mcp/types';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function mainParse() {
  const community = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        deepwiki: { url: 'https://mcp.deepwiki.com/mcp' },
        context7: {
          url: 'https://mcp.context7.com/mcp',
          headers: { Authorization: 'Bearer secret-token' },
        },
      },
    })
  );
  assert(community.ok, 'community mcpServers document parses');
  if (!community.ok) return;
  assert(community.servers[0]?.name === 'deepwiki', 'deepwiki name comes from the key');
  assert(community.servers[0]?.rewriteOrigin === false, 'remote https does not rewrite origin');
  assert(
    community.servers[1]?.headers[0]?.value === 'Bearer secret-token',
    'header object is kept for storage'
  );
  const again = parseMcpServersDocument(serversToMcpDocument(community.servers));
  assert(
    again.ok && again.servers[1]?.headers[0]?.value === 'Bearer secret-token',
    'round trip keeps headers'
  );

  const migrated = parseMcpServersDocument(
    JSON.stringify([
      {
        name: 'docs',
        url: 'http://127.0.0.1:8080/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer old' }],
        enabled: true,
        timeout: 30,
      },
    ])
  );
  assert(
    migrated.ok && migrated.servers[0]?.rewriteOrigin === true,
    'old array migrates and loopback rewrites'
  );
  assert(
    normalizeStoredMcpServers([
      { name: 'docs', url: 'http://127.0.0.1:8080/mcp', headers: [], enabled: true, timeout: 30 },
    ])[0]?.name === 'docs',
    'stored array still loads'
  );

  const broken = parseMcpServersDocument('{');
  assert(!broken.ok && broken.issues[0]?.code === 'json', 'invalid json does not yield servers');

  const stdio = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        files: {
          command: 'npx',
          args: ['-y', 'some-server'],
          env: { TOKEN: 'super-secret' },
        },
      },
    })
  );
  assert(!stdio.ok && stdio.issues.some((item) => item.code === 'stdio'), 'stdio is rejected');
  assert(!JSON.stringify(stdio).includes('super-secret'), 'stdio errors do not include env values');

  const sse = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: { legacy: { type: 'sse', url: 'https://example.com/sse' } },
    })
  );
  assert(
    !sse.ok && sse.issues.some((item) => item.code === 'sse'),
    'legacy sse transport is rejected'
  );

  const oauth = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        docs: { url: 'https://example.com/mcp', oauth: { clientSecret: 'super-secret' } },
      },
    })
  );
  assert(!oauth.ok && oauth.issues.some((item) => item.code === 'oauth'), 'oauth is rejected');
  assert(!JSON.stringify(oauth).includes('super-secret'), 'oauth errors do not include secrets');

  const unknown = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: { docs: { url: 'https://example.com/mcp', apiKey: 'super-secret' } },
    })
  );
  assert(
    !unknown.ok &&
      unknown.issues.some((item) => item.code === 'unsupported' && item.detail === 'apiKey'),
    'unknown fields are named, not dropped'
  );
  assert(
    !JSON.stringify(unknown).includes('super-secret'),
    'unknown field values are not copied into errors'
  );

  const protoDoc = '{"mcpServers":{"__proto__":{"url":"https://example.com/mcp"}}}';
  const proto = parseMcpServersDocument(protoDoc);
  assert(
    proto.ok && proto.servers.length === 1 && proto.servers[0]?.name === '__proto__',
    'proto name is a real server'
  );
  if (proto.ok) {
    const rewritten = serversToMcpDocument(proto.servers);
    const round = parseMcpServersDocument(rewritten);
    assert(
      round.ok && round.servers.length === 1 && round.servers[0]?.url === 'https://example.com/mcp',
      'proto name survives a save and reload'
    );
    const document = JSON.parse(rewritten) as { mcpServers: Record<string, unknown> };
    assert(
      Object.prototype.hasOwnProperty.call(document.mcpServers, '__proto__'),
      'rewritten proto key is own data'
    );
  }
  const constructorName = parseMcpServersDocument(
    JSON.stringify({ mcpServers: { constructor: { url: 'https://example.com/mcp' } } })
  );
  assert(constructorName.ok, 'constructor is an allowed server name');
  if (constructorName.ok) {
    const round = parseMcpServersDocument(serversToMcpDocument(constructorName.servers));
    assert(round.ok && round.servers[0]?.name === 'constructor', 'constructor name round-trips');
  }

  const badObjectHeader = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        docs: {
          url: 'https://example.com/mcp',
          headers: { 'Bad Header': 'super-secret', Authorization: 'Bearer\nsuper-secret' },
        },
      },
    })
  );
  assert(!badObjectHeader.ok, 'object headers with a space or newline are rejected');
  assert(
    !JSON.stringify(badObjectHeader).includes('super-secret'),
    'header errors do not echo values'
  );

  const emptyObjectHeader = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: { docs: { url: 'https://example.com/mcp', headers: { '': 'super-secret' } } },
    })
  );
  assert(!emptyObjectHeader.ok, 'an empty header name is rejected');
  assert(
    !JSON.stringify(emptyObjectHeader).includes('super-secret'),
    'empty-name errors do not echo values'
  );

  const badArrayHeader = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        docs: {
          url: 'https://example.com/mcp',
          headers: [{ name: 'Bad Header', value: 'super-secret' }],
        },
      },
    })
  );
  assert(!badArrayHeader.ok, 'array headers with an illegal name are rejected');
  const newlineArrayHeader = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        docs: {
          url: 'https://example.com/mcp',
          headers: [{ name: 'Authorization', value: 'Bearer\r\nsuper-secret' }],
        },
      },
    })
  );
  assert(!newlineArrayHeader.ok, 'array header values cannot contain newlines');
  assert(
    !JSON.stringify(newlineArrayHeader).includes('super-secret'),
    'array header errors do not echo values'
  );
  const kept = [{ name: 'keep', url: 'https://example.com/mcp' }];
  const rejectedHeaders = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: { docs: { url: 'https://example.com/mcp', headers: { '': 'x' } } },
    })
  );
  const storedHeaders = rejectedHeaders.ok ? rejectedHeaders.servers : kept;
  assert(storedHeaders === kept, 'invalid headers do not replace the saved servers');

  const mixedTransport = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: { docs: { url: 'https://example.com/mcp', type: 'http', transport: 'sse' } },
    })
  );
  assert(
    !mixedTransport.ok && mixedTransport.issues.some((item) => item.code === 'sse'),
    'http plus sse is rejected'
  );

  const equivalent = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: {
        docs: { url: 'https://example.com/mcp', type: 'http', transport: 'streamable-http' },
      },
    })
  );
  assert(equivalent.ok, 'http and streamable-http name the same transport');
  const onlyTransport = parseMcpServersDocument(
    JSON.stringify({
      mcpServers: { docs: { url: 'https://example.com/mcp', transport: 'streamable-http' } },
    })
  );
  assert(onlyTransport.ok, 'transport streamable-http is accepted without type');

  const previous = [{ name: 'keep', url: 'https://example.com/mcp' }];
  const rejected = parseMcpServersDocument('{');
  const stored = rejected.ok ? rejected.servers : previous;
  assert(stored === previous, 'a failed parse leaves the caller on the previous config');
}

async function streamableHttpAcceptsEventStream() {
  let accept = '';
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; id?: number };
    accept = new Headers(init?.headers).get('accept') ?? accept;
    if (body.method === 'initialize') {
      const payload = {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'demo', version: '0' },
        },
      };
      return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 's1' },
      });
    }
    return new Response(null, { status: 202 });
  };
  const client = new McpClient({ name: 'duidaruliu', version: '0.0.4' });
  const transport = new StreamableHttpTransport({
    url: 'https://mcp.deepwiki.com/mcp',
    fetch: fetchImpl,
    openGetStream: false,
  });
  await client.connect(transport);
  assert(accept.includes('text/event-stream'), 'Streamable HTTP asks for an SSE response');
  assert(client.serverInfo?.name === 'demo', 'an SSE initialize response is accepted');
  await client.close();
}

async function main() {
  mainParse();
  await streamableHttpAcceptsEventStream();
  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('mcp json fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
