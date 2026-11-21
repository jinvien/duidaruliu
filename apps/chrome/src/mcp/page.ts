import { mcpOriginRewriteDefault, normalizeStoredMcpServers, type McpServerRecord } from './types';

/** 设置页是另一个 sidepanel.html。只有聊天侧栏持有 MCP 连接和 Origin 规则。 */
export function mcpPageOwnsRuntime(appMode: string | null | undefined): boolean {
  return appMode !== 'setting';
}

/**
 * 设置页写入 chrome.storage.local。聊天侧栏只认这两个键，不跟 sync 广播。
 * 返回 null 表示这次变更与 MCP 无关。
 */
export function readMcpLocalChange(
  area: string,
  changes: Record<string, { newValue?: unknown } | undefined> | null | undefined
): { servers?: McpServerRecord[]; toolsEnabled?: boolean } | null {
  if (area !== 'local' || !changes) return null;
  const next: { servers?: McpServerRecord[]; toolsEnabled?: boolean } = {};
  if (changes.mcpServers) next.servers = normalizeStoredMcpServers(changes.mcpServers.newValue);
  if (changes.mcpToolsEnabled) next.toolsEnabled = changes.mcpToolsEnabled.newValue === true;
  if (next.servers === undefined && next.toolsEnabled === undefined) return null;
  return next;
}

/** 没动过开关时，保存按地址决定是否重写 Origin，而不是一直留着新增时的 false。 */
export function rewriteOriginForSave(
  url: string,
  rewriteOrigin: boolean,
  touched: boolean
): boolean {
  if (touched) return rewriteOrigin;
  return mcpOriginRewriteDefault(url);
}
