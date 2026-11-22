import { validateMcpServerConfig } from '@earendil-works/pi-mcp';

import {
  headerRecord,
  isHttpHeaderName,
  isHttpHeaderValue,
  mcpOriginRewriteDefault,
  DEFAULT_MCP_TIMEOUT_SECONDS,
  type McpHeader,
  type McpServerRecord,
} from './types';

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const KNOWN_FIELDS = new Set([
  'url',
  'headers',
  'enabled',
  'timeout',
  'description',
  'rewriteOrigin',
  'type',
  'transport',
  'name',
]);
const STDIO_FIELDS = ['command', 'args', 'env', 'cwd'] as const;

export type McpConfigIssue = {
  code:
    | 'json'
    | 'shape'
    | 'name'
    | 'stdio'
    | 'sse'
    | 'oauth'
    | 'unsupported'
    | 'invalid'
    | 'duplicate';
  server?: string;
  detail?: string;
};

export type McpConfigParse =
  | { ok: true; servers: McpServerRecord[] }
  | { ok: false; issues: McpConfigIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(code: McpConfigIssue['code'], server?: string, detail?: string): McpConfigIssue {
  return {
    code,
    ...(server ? { server } : {}),
    ...(detail ? { detail } : {}),
  };
}

const STREAMABLE_HTTP = new Set(['http', 'streamable-http']);

function assignOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** 编辑器里展示的社区格式。请求头是对象，不写进日志。 */
export function serversToMcpDocument(servers: readonly McpServerRecord[]): string {
  const mcpServers = Object.create(null) as Record<string, Record<string, unknown>>;
  for (const server of servers) {
    const entry = Object.create(null) as Record<string, unknown>;
    if (server.command) entry.command = server.command;
    if (server.url) entry.url = server.url;
    if (server.headers.length) entry.headers = headerRecord(server.headers);
    if (server.description) entry.description = server.description;
    entry.enabled = server.enabled;
    entry.timeout = server.timeout;
    entry.rewriteOrigin = server.rewriteOrigin;
    assignOwn(mcpServers, server.name, entry);
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

function isStreamable(value: unknown): value is string {
  return typeof value === 'string' && STREAMABLE_HTTP.has(value);
}

/** type 和 transport 都要看。只认等价的 Streamable HTTP 写法，冲突不能丢掉其中一个。 */
function rejectTransport(entry: Record<string, unknown>, server: string, issues: McpConfigIssue[]) {
  const { type, transport } = entry;
  if (type === 'sse' || transport === 'sse') {
    issues.push(issue('sse', server));
    return true;
  }
  if (
    (type !== undefined && !isStreamable(type)) ||
    (transport !== undefined && !isStreamable(transport))
  ) {
    issues.push(issue('unsupported', server, 'type'));
    return true;
  }
  return false;
}

function unsupportedKeys(entry: Record<string, unknown>): string[] {
  return Object.keys(entry).filter(
    (key) => !KNOWN_FIELDS.has(key) && !STDIO_FIELDS.includes(key as (typeof STDIO_FIELDS)[number])
  );
}

function headerIssue(server: string, issues: McpConfigIssue[]) {
  issues.push(
    issue('invalid', server, 'headers must use an HTTP token name and a single-line value')
  );
}

function headersOf(
  entry: Record<string, unknown>,
  server: string,
  issues: McpConfigIssue[]
): McpHeader[] | undefined {
  if (entry.headers === undefined) return [];
  const pairs: McpHeader[] = [];
  const seen = new Set<string>();
  const take = (name: unknown, value: unknown) => {
    if (typeof name !== 'string' || typeof value !== 'string') return false;
    if (!isHttpHeaderName(name) || !isHttpHeaderValue(value)) return false;
    const folded = name.toLowerCase();
    if (seen.has(folded)) return false;
    seen.add(folded);
    pairs.push({ name, value });
    return true;
  };
  if (Array.isArray(entry.headers)) {
    for (const item of entry.headers) {
      if (!isRecord(item) || !take(item.name, item.value)) {
        headerIssue(server, issues);
        return undefined;
      }
    }
    return pairs;
  }
  if (!isRecord(entry.headers)) {
    headerIssue(server, issues);
    return undefined;
  }
  for (const [name, value] of Object.entries(entry.headers)) {
    if (!take(name, value)) {
      headerIssue(server, issues);
      return undefined;
    }
  }
  return pairs;
}

function parseEntry(name: string, value: unknown, issues: McpConfigIssue[]) {
  if (!SERVER_NAME.test(name)) {
    issues.push(issue('name', name));
    return;
  }
  if (!isRecord(value)) {
    issues.push(issue('invalid', name, 'server must be an object'));
    return;
  }
  if (typeof value.name === 'string' && value.name !== name) {
    issues.push(issue('name', name));
    return;
  }
  const stdio = STDIO_FIELDS.filter((key) => value[key] !== undefined);
  if (stdio.length) {
    issues.push(issue('stdio', name, stdio.join(', ')));
    return;
  }
  if (value.oauth !== undefined) {
    issues.push(issue('oauth', name));
    return;
  }
  if (value.rewriteOrigin !== undefined && typeof value.rewriteOrigin !== 'boolean') {
    issues.push(issue('invalid', name, 'rewriteOrigin must be a boolean'));
    return;
  }
  if (rejectTransport(value, name, issues)) return;
  const unknown = unsupportedKeys(value);
  if (unknown.length) {
    issues.push(issue('unsupported', name, unknown.join(', ')));
    return;
  }
  const headers = headersOf(value, name, issues);
  if (!headers) return;
  const raw = {
    url: value.url,
    headers: headerRecord(headers),
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    ...(value.timeout !== undefined ? { timeout: value.timeout } : {}),
    ...(value.description !== undefined ? { description: value.description } : {}),
    ...(isStreamable(value.type) ? { type: value.type } : {}),
  };
  const result = validateMcpServerConfig(name, raw);
  if (result.kind === 'stdio') {
    issues.push(issue('stdio', name));
    return;
  }
  if (result.kind === 'invalid') {
    issues.push(issue('invalid', name, result.error));
    return;
  }
  const url = result.config.url;
  const timeout =
    typeof value.timeout === 'number' && value.timeout > 0
      ? value.timeout
      : DEFAULT_MCP_TIMEOUT_SECONDS;
  const record: McpServerRecord = {
    name,
    url,
    headers,
    enabled: value.enabled !== false,
    timeout,
    rewriteOrigin:
      typeof value.rewriteOrigin === 'boolean' ? value.rewriteOrigin : mcpOriginRewriteDefault(url),
  };
  if (typeof value.description === 'string' && value.description) {
    record.description = value.description;
  }
  return record;
}

function entriesFromRoot(root: unknown, issues: McpConfigIssue[]): [string, unknown][] | null {
  if (Array.isArray(root)) {
    const entries: [string, unknown][] = [];
    for (const item of root) {
      if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) {
        issues.push(issue('shape'));
        return null;
      }
      entries.push([item.name.trim(), item]);
    }
    return entries;
  }
  if (!isRecord(root)) {
    issues.push(issue('shape'));
    return null;
  }
  if (root.mcpServers !== undefined) {
    const extra = Object.keys(root).filter((key) => key !== 'mcpServers');
    if (extra.length) {
      issues.push(issue('unsupported', undefined, extra.join(', ')));
      return null;
    }
    if (!isRecord(root.mcpServers)) {
      issues.push(issue('shape'));
      return null;
    }
    return Object.entries(root.mcpServers);
  }
  if (Object.keys(root).length === 0) {
    issues.push(issue('shape'));
    return null;
  }
  if (Object.values(root).every(isRecord)) return Object.entries(root);
  issues.push(issue('shape'));
  return null;
}

/**
 * 解析编辑器里的 JSON。失败时不返回服务器列表，调用方不能用它覆盖已保存的配置。
 * 问题描述只包含字段名和校验原因，不包含请求头的值。
 */
export function parseMcpServersDocument(text: string): McpConfigParse {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, issues: [issue('json')] };
  }
  const issues: McpConfigIssue[] = [];
  const entries = entriesFromRoot(root, issues);
  if (!entries) return { ok: false, issues };
  const seen = new Set<string>();
  const servers: McpServerRecord[] = [];
  for (const [name, value] of entries) {
    if (seen.has(name)) {
      issues.push(issue('duplicate', name));
      continue;
    }
    seen.add(name);
    const server = parseEntry(name, value, issues);
    if (server) servers.push(server);
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, servers };
}
