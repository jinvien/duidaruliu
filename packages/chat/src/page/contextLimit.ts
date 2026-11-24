import { findActiveCustomModel, selectActiveContextWindow } from '../models/selection';

import type { RootState } from '../store';

/** Ollama 没设置 num_ctx 时的默认上下文窗口。 */
export const OLLAMA_DEFAULT_NUM_CTX = 2048;

/** 当前模型的上下文窗口。自定义模型没声明时返回 null，界面就不提示。 */
export function selectContextLimit(state: RootState): number | null {
  const custom = findActiveCustomModel(state);
  if (custom) return selectActiveContextWindow(state) ?? null;
  return state.ollama.ollamaModelParams.options?.num_ctx ?? OLLAMA_DEFAULT_NUM_CTX;
}
