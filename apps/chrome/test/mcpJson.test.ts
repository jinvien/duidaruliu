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
