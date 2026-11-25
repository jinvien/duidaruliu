import { MCP_MODEL_TOOL_CAP } from './tools';

import type { CapabilityMark } from '../utils/modelCapability';

export type ModelToolCapability = 'tools' | 'pending' | 'unknown' | 'absent';

export type ChatToolNotice =
  | { kind: 'hidden' }
  | { kind: 'switchOff' }
  | { kind: 'modelPending' }
  | { kind: 'modelUnknown' }
  | { kind: 'modelUnsupported' }
  | { kind: 'noTools' }
  | { kind: 'active'; count: number };

/** 总开关打开且模型明确有 tools 时，才允许把工具注册进循环。 */
export function shouldExposeTools(toolsEnabled: boolean, hasTools: boolean): boolean {
  return toolsEnabled && hasTools;
}

/**
 * 设置里的「已连接」不等于这次 /api/chat 会带 tools。
 * 已确认没有 tools 的模型优先说明原因，避免用户只打开总开关后仍然看不到工具。
 */
export function explainChatTools(input: {
  toolsEnabled: boolean;
  enabledServerCount: number;
  connectedToolCount: number;
  capability: ModelToolCapability;
}): ChatToolNotice {
  const interested =
    input.toolsEnabled || input.enabledServerCount > 0 || input.connectedToolCount > 0;
  if (!interested) return { kind: 'hidden' };
  if (input.capability === 'absent') return { kind: 'modelUnsupported' };
  if (!input.toolsEnabled) return { kind: 'switchOff' };
  if (input.capability === 'pending') return { kind: 'modelPending' };
  if (input.capability === 'unknown') return { kind: 'modelUnknown' };
  const count = Math.min(Math.max(0, input.connectedToolCount), MCP_MODEL_TOOL_CAP);
  if (!shouldExposeTools(input.toolsEnabled, true) || count === 0) return { kind: 'noTools' };
  return { kind: 'active', count };
}

export function modelToolCapability(input: {
  hasTools: boolean;
  mark: CapabilityMark | null;
}): ModelToolCapability {
  if (input.hasTools || input.mark === 'tools') return 'tools';
  if (input.mark === 'pending') return 'pending';
  if (input.mark === 'unknown') return 'unknown';
  return 'absent';
}
