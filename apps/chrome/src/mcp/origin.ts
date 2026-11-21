import type { McpServerRecord } from './types';

export const OLLAMA_ORIGIN_RULE_ID = 1;
export const OLLAMA_ORIGIN_RULE_PRIORITY = 1;
export const MCP_ORIGIN_RULE_ID_START = 100;
export const MCP_ORIGIN_RULE_PRIORITY = 2;

export type OriginRewriteRule = {
  id: number;
  priority: number;
  condition: { regexFilter: string; initiatorDomains?: string[] };
  action: {
    type: 'modifyHeaders';
    requestHeaders: { header: string; operation: 'set'; value: string }[];
  };
};

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

function originRule(
  id: number,
  priority: number,
  origin: string,
  initiatorDomains?: string[]
): OriginRewriteRule {
  return {
    id,
    priority,
    condition: {
      regexFilter: `^${escapeRegExp(origin)}(/|$)`,
      ...(initiatorDomains ? { initiatorDomains } : {}),
    },
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Origin', operation: 'set', value: origin }],
    },
  };
}

/** Ollama 只匹配自己的 origin（含端口），不再盖住同一主机上的其他端口。 */
export function planOllamaOriginRule(rewriteUrl: string): OriginRewriteRule | null {
  const origin = originOf(rewriteUrl);
  if (!origin) return null;
  return originRule(OLLAMA_ORIGIN_RULE_ID, OLLAMA_ORIGIN_RULE_PRIORITY, origin);
}

/**
 * 每个需要改写的 origin 一条规则，id 从 100 起，优先级高于 Ollama。
 * initiatorDomains 用扩展 id，只改侧栏自己发出的请求。
 */
export function planMcpOriginRules(
  servers: McpServerRecord[],
  extensionId: string
): OriginRewriteRule[] {
  if (!extensionId) return [];
  const origins: string[] = [];
  for (const server of servers) {
    if (!server.enabled || !server.rewriteOrigin || !server.url) continue;
    const origin = originOf(server.url);
    if (!origin || origins.includes(origin)) continue;
    origins.push(origin);
  }
  return origins.map((origin, index) =>
    originRule(MCP_ORIGIN_RULE_ID_START + index, MCP_ORIGIN_RULE_PRIORITY, origin, [extensionId])
  );
}

/** 关闭侧栏时删掉的规则 id。保留 Ollama 的规则 1。 */
export function mcpOriginRuleIds(ids: readonly number[]): number[] {
  return ids.filter((id) => id >= MCP_ORIGIN_RULE_ID_START);
}
