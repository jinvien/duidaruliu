import { validateMcpServerConfig } from '@earendil-works/pi-mcp';

import {
  headerRecord,
  mcpOriginRewriteDefault,
  normalizeHeaders,
  DEFAULT_MCP_TIMEOUT_SECONDS,
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

/** 编辑器里展示的社区格式。请求头是对象，不写进日志。 */
export function serversToMcpDocument(servers: readonly McpServerRecord[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const entry: Record<string, unknown> = {};
    if (server.command) entry.command = server.command;
    if (server.url) entry.url = server.url;
    const headers = headerRecord(server.headers);
    if (Object.keys(headers).length) entry.headers = headers;
    if (server.description) entry.description = server.description;
    entry.enabled = server.enabled;
    entry.timeout = server.timeout;
    entry.rewriteOrigin = server.rewriteOrigin;
    mcpServers[server.name] = entry;
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

function transportOf(entry: Record<string, unknown>): unknown {
  return entry.type !== undefined ? entry.type : entry.transport;
}

function unsupportedKeys(entry: Record<string, unknown>): string[] {
  return Object.keys(entry).filter(
    (key) => !KNOWN_FIELDS.has(key) && !STDIO_FIELDS.includes(key as (typeof STDIO_FIELDS)[number])
  );
}

function headersOf(
  entry: Record<string, unknown>,
  server: string,
  issues: McpConfigIssue[]
): Record<string, string> | undefined {
  if (entry.headers === undefined) return {};
  const invalid = () => {
    issues.push(issue('invalid', server, 'headers must map names to strings'));
    return undefined;
  };
  if (Array.isArray(entry.headers)) {
    const names = new Set<string>();
    for (const item of entry.headers) {
      if (!isRecord(item) || typeof item.name !== 'string' || typeof item.value !== 'string') {
        return invalid();
      }
      const headerName = item.name.trim();
      if (!headerName || names.has(headerName)) return invalid();
      names.add(headerName);
    }
  } else if (!isRecord(entry.headers)) {
    return invalid();
  } else if (Object.values(entry.headers).some((value) => typeof value !== 'string')) {
    return invalid();
  }
  return headerRecord(normalizeHeaders(entry.headers));
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
  const transport = transportOf(value);
  if (transport === 'sse') {
    issues.push(issue('sse', name));
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
  if (transport !== undefined && transport !== 'http' && transport !== 'streamable-http') {
    issues.push(issue('unsupported', name, 'type'));
    return;
  }
  const unknown = unsupportedKeys(value);
  if (unknown.length) {
    issues.push(issue('unsupported', name, unknown.join(', ')));
    return;
  }
  const headers = headersOf(value, name, issues);
  if (!headers) return;
  const raw = {
    url: value.url,
    headers,
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    ...(value.timeout !== undefined ? { timeout: value.timeout } : {}),
    ...(value.description !== undefined ? { description: value.description } : {}),
    ...(transport === 'http' || transport === 'streamable-http' ? { type: transport } : {}),
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
    headers: Object.entries(headers).map(([headerName, headerValue]) => ({
      name: headerName,
      value: headerValue,
    })),
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
