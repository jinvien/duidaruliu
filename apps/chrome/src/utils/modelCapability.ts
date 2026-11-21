export type OllamaListedModel = {
  name: string;
  capabilities: string[];
  /** /api/tags 或 /api/show 已经给出 capabilities 数组 */
  capabilitiesKnown: boolean;
};

export const VISION_CAPABILITY = 'vision';

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

/** 只有明确上报 vision 时才开放选图，避免把纯文本模型误导成视觉模型。 */
export function modelHasVision(models: OllamaListedModel[], modelName?: string): boolean {
  if (!modelName) return false;
  const found = models.find((item) => item.name === modelName);
  return Boolean(found?.capabilitiesKnown && found.capabilities.includes(VISION_CAPABILITY));
}
