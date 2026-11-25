export type CapabilityState = 'known' | 'pending' | 'unknown';

export type OllamaListedModel = {
  name: string;
  capabilities: string[];
  /**
   * known: tags 或 show 已给出 capabilities。
   * pending: 还在请求 /api/show，不能当成已确认无视觉。
   * unknown: show 失败或没有能力字段，仍然不能选图。
   */
  capabilityState: CapabilityState;
};

export type CapabilityMark = 'vision' | 'tools' | 'pending' | 'unknown';

export const VISION_CAPABILITY = 'vision';
export const TOOLS_CAPABILITY = 'tools';

export function parseCapabilities(raw: unknown): {
  capabilities: string[];
  capabilitiesKnown: boolean;
} {
  if (!Array.isArray(raw)) {
    return { capabilities: [], capabilitiesKnown: false };
  }
  return {
    capabilities: raw.filter((item): item is string => typeof item === 'string'),
    capabilitiesKnown: true,
  };
}

export function findListedModel(models: OllamaListedModel[], modelName?: string) {
  if (!modelName) return undefined;
  return models.find((item) => item.name === modelName);
}

/** 只有明确上报 vision 时才开放选图。检测中和未知都不开放。 */
export function modelHasVision(models: OllamaListedModel[], modelName?: string): boolean {
  const found = findListedModel(models, modelName);
  return Boolean(
    found?.capabilityState === 'known' && found.capabilities.includes(VISION_CAPABILITY)
  );
}

/** 只有明确上报 tools 时才把 MCP 工具放进 /api/chat。检测中和未知都不发送。 */
export function modelHasTools(models: OllamaListedModel[], modelName?: string): boolean {
  const found = findListedModel(models, modelName);
  return Boolean(
    found?.capabilityState === 'known' && found.capabilities.includes(TOOLS_CAPABILITY)
  );
}

/** 已确认没有 tools 时返回 null。检测中和未知要显示在模型旁边。 */
export function modelToolsMark(
  models: OllamaListedModel[],
  modelName: string | undefined,
  listState: 'loading' | 'ready' | 'error'
): CapabilityMark | null {
  const found = findListedModel(models, modelName);
  if (!found) {
    if (!modelName) return null;
    if (listState === 'loading') return 'pending';
    if (listState === 'error') return 'unknown';
    return null;
  }
  if (found.capabilityState === 'pending') return 'pending';
  if (found.capabilityState === 'unknown') return 'unknown';
  if (found.capabilities.includes(TOOLS_CAPABILITY)) return 'tools';
  return null;
}

/**
 * 已确认无视觉时返回 null。
 * loading：列表或该模型的 show 还没结束，显示检测中。
 * error：列表请求失败，当前模型不能当成已确认无视觉。
 */
export function modelCapabilityMark(
  models: OllamaListedModel[],
  modelName: string | undefined,
  listState: 'loading' | 'ready' | 'error'
): CapabilityMark | null {
  const found = findListedModel(models, modelName);
  if (!found) {
    if (!modelName) return null;
    if (listState === 'loading') return 'pending';
    if (listState === 'error') return 'unknown';
    return null;
  }
  if (found.capabilityState === 'pending') return 'pending';
  if (found.capabilityState === 'unknown') return 'unknown';
  if (found.capabilities.includes(VISION_CAPABILITY)) return 'vision';
  return null;
}
