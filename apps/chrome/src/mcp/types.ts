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
  /** 只随 JSON 回写，不参与连接。 */
  description?: string;
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

const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** HTTP 字段名是 token。空名、空格和换行都不是合法名字。 */
export function isHttpHeaderName(name: string): boolean {
  return HTTP_HEADER_NAME.test(name);
}

/**
 * 与 Fetch Headers 的 ByteString 对齐：码位必须落在 0x00–0xFF。
 * 另外拒绝控制字符，只留 HTAB。报错用固定文案，不带原值和异常。
 */
export function isHttpHeaderValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0xff) return false;
    if (code === 0x09) continue;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function assignOwn(target: Record<string, string>, key: string, value: string) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function headerRecord(headers: McpHeader[]): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const header of headers) {
    assignOwn(result, header.name, header.value);
  }
  return result;
}

function normalizeOne(fallbackName: string, value: unknown): McpServerRecord | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' && value.name ? value.name : fallbackName;
  if (!name) return null;
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const command = typeof value.command === 'string' ? value.command : undefined;
  const description = typeof value.description === 'string' ? value.description : undefined;
  const timeout =
    typeof value.timeout === 'number' && value.timeout > 0
      ? value.timeout
      : DEFAULT_MCP_TIMEOUT_SECONDS;
  return {
    name,
    url,
    ...(command ? { command } : {}),
    ...(description ? { description } : {}),
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
