import { createSelector } from '@reduxjs/toolkit';

import { customModelKey, expandCustomServices, type CustomModel } from './customModel';
import {
  TOOLS_CAPABILITY,
  VISION_CAPABILITY,
  type OllamaListedModel,
} from '../utils/modelCapability';

import type { RootState } from '../store';

/** 自定义模型的能力由用户声明，视为已确认，直接复用 Ollama 模型的能力判断函数。 */
export function customModelAsListed(model: CustomModel): OllamaListedModel {
  const capabilities: string[] = [];
  if (model.vision) capabilities.push(VISION_CAPABILITY);
  if (model.tools) capabilities.push(TOOLS_CAPABILITY);
  return { name: customModelKey(model.id), capabilities, capabilityState: 'known' };
}

/** 所有服务展开后的模型列表。 */
export const selectCustomModels = createSelector(
  [(state: RootState) => state.customModel.services],
  (services): CustomModel[] => expandCustomServices(services)
);

export function findActiveCustomModel(state: RootState): CustomModel | undefined {
  const { activeId } = state.customModel;
  return activeId ? selectCustomModels(state).find((model) => model.id === activeId) : undefined;
}

/** Ollama 模型和自定义模型放进同一份能力表，键不会重名（自定义带 custom: 前缀）。 */
export const selectCombinedModels = createSelector(
  [(state: RootState) => state.ollama.listedModels, selectCustomModels],
  (listed, custom): OllamaListedModel[] => [...listed, ...custom.map(customModelAsListed)]
);

/** 下拉框的值，也是能力表里的键。 */
export function selectSelectedModelKey(state: RootState): string {
  const custom = findActiveCustomModel(state);
  return custom ? customModelKey(custom.id) : state.ollama.ollamaModelParams.model;
}

/** 写进消息、显示在气泡标题上的名字。 */
export function selectSelectedModelLabel(state: RootState): string {
  return findActiveCustomModel(state)?.model ?? state.ollama.ollamaModelParams.model;
}

/** 自定义模型直连云端，不依赖本机 Ollama 是否在线。 */
export function selectBackendReady(state: RootState): boolean {
  return Boolean(findActiveCustomModel(state)) || state.ollama.ollamaIsRunning;
}
