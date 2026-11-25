import type { McpConnectionStatus } from './session';

export type SavedServerStatus = 'disabled' | McpConnectionStatus;

export type SavedServerSummary = {
  status: SavedServerStatus;
  toolCount: number;
  detail?: string;
};

/** 设置页一行服务器只展示名称、状态和工具数量。未启用优先于连接状态。 */
export function summarizeSavedServer(
  server: { enabled: boolean },
  runtime: { status: McpConnectionStatus; tools: readonly unknown[]; detail?: string } | undefined
): SavedServerSummary {
  if (!server.enabled) return { status: 'disabled', toolCount: 0 };
  if (!runtime || runtime.status === 'idle') return { status: 'idle', toolCount: 0 };
  if (runtime.status === 'connected') {
    return { status: 'connected', toolCount: runtime.tools.length };
  }
  return {
    status: runtime.status,
    toolCount: 0,
    ...(runtime.detail ? { detail: runtime.detail } : {}),
  };
}
