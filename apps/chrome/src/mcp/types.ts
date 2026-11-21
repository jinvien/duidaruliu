export type McpHeader = {
  name: string;
  value: string;
};

/** 保存在 chrome.storage.local 的 mcpServers。请求头可能含令牌，不能进 sync。 */
export type McpServerRecord = {
  name: string;
  url: string;
  command?: string;
  headers: McpHeader[];
  enabled: boolean;
  timeout: number;
  rewriteOrigin: boolean;
};

export const DEFAULT_MCP_TIMEOUT_SECONDS = 30;

export function mcpOriginRewriteDefault(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeHeaders(raw: unknown): McpHeader[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string' || typeof item.value !== 'string') {
        return [];
      }
      return [{ name: item.name, value: item.value }];
    });
  }
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([name, value]) =>
    typeof value === 'string' ? [{ name, value }] : []
  );
}

export function headerRecord(headers: McpHeader[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    const name = header.name.trim();
    if (!name) continue;
    result[name] = header.value;
  }
  return result;
}

function normalizeOne(fallbackName: string, value: unknown): McpServerRecord | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' && value.name ? value.name : fallbackName;
  if (!name) return null;
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const command = typeof value.command === 'string' ? value.command : undefined;
  const timeout =
    typeof value.timeout === 'number' && value.timeout > 0
      ? value.timeout
      : DEFAULT_MCP_TIMEOUT_SECONDS;
  return {
    name,
    url,
    ...(command ? { command } : {}),
    headers: normalizeHeaders(value.headers),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    timeout,
    rewriteOrigin:
      typeof value.rewriteOrigin === 'boolean' ? value.rewriteOrigin : mcpOriginRewriteDefault(url),
  };
}

export function normalizeStoredMcpServers(raw: unknown): McpServerRecord[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (!isRecord(item)) return [];
      const name = typeof item.name === 'string' ? item.name : '';
      const server = normalizeOne(name, item);
      return server ? [server] : [];
    });
  }
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([name, value]) => {
    const server = normalizeOne(name, value);
    return server ? [server] : [];
  });
}
