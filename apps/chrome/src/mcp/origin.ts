import type { McpServerRecord } from './types';

export const MCP_ORIGIN_RULE_ID_START = 100;

export type McpOriginRule = {
  id: number;
  priority: number;
  condition: { regexFilter: string };
  action: {
    type: 'modifyHeaders';
    requestHeaders: { header: string; operation: 'set'; value: string }[];
  };
};

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** 每个需要改写的 origin 一条规则，id 从 100 起。不占用 Ollama 的规则 1。 */
export function planMcpOriginRules(servers: McpServerRecord[]): McpOriginRule[] {
  const origins: string[] = [];
  for (const server of servers) {
    if (!server.enabled || !server.rewriteOrigin || !server.url) continue;
    let origin = '';
    try {
      origin = new URL(server.url).origin;
    } catch {
      continue;
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins.map((origin, index) => ({
    id: MCP_ORIGIN_RULE_ID_START + index,
    priority: 1,
    condition: { regexFilter: `^${escapeRegExp(origin)}(/|$)` },
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Origin', operation: 'set', value: origin }],
    },
  }));
}
