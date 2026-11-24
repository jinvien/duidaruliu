import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { storageGet, storageSet } from '../host';
import {
  expandCustomServices,
  normalizeStoredCustomServices,
  type CustomService,
} from '../models/customModel';

import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from './index';

export type CustomModelState = {
  services: CustomService[];
  /** 当前选中的自定义模型（服务 id + 模型名）。为 null 时使用 Ollama。 */
  activeId: string | null;
  /** 用户在选择模型时关掉思考的模型 id。不在里面的都按开启处理。 */
  thinkingOff: string[];
  /** 每个模型选中的上下文窗口。没选过、或选的值已不在可选项里，按最大一档处理。 */
  contextChoice: Record<string, number>;
  loaded: boolean;
};

type AppThunk = ThunkAction<Promise<void>, RootState, unknown, UnknownAction>;

const initialState: CustomModelState = {
  services: [],
  activeId: null,
  thinkingOff: [],
  contextChoice: {},
  loaded: false,
};

// 含 API Key，只放 local，不进会随账号同步的 sync。
export const CUSTOM_SERVICES_STORAGE_KEY = 'customServices';
export const ACTIVE_CUSTOM_MODEL_STORAGE_KEY = 'activeCustomModelId';
export const THINKING_OFF_STORAGE_KEY = 'customThinkingOff';
export const CONTEXT_CHOICE_STORAGE_KEY = 'customContextChoice';

function hasModel(services: CustomService[], id: unknown): id is string {
  return typeof id === 'string' && expandCustomServices(services).some((model) => model.id === id);
}

function readActiveId(raw: unknown, services: CustomService[]): string | null {
  return hasModel(services, raw) ? raw : null;
}

/** 存储里读出来的值不可信。只留还存在的模型，去重。 */
function readThinkingOff(raw: unknown, services: CustomService[]): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(expandCustomServices(services).map((model) => model.id));
  return [...new Set(raw)].filter((id): id is string => typeof id === 'string' && ids.has(id));
}

/** 存储里读出来的值不可信。只留还存在的模型，且值必须是正整数。 */
function readContextChoice(raw: unknown, services: CustomService[]): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const ids = new Set(expandCustomServices(services).map((model) => model.id));
  const result: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (ids.has(id) && typeof value === 'number' && Number.isInteger(value) && value > 0) {
      result[id] = value;
    }
  }
  return result;
}

export const initializeCustomModels = createAsyncThunk('customModel/initialize', async () => {
  const stored = await storageGet('local', [
    CUSTOM_SERVICES_STORAGE_KEY,
    ACTIVE_CUSTOM_MODEL_STORAGE_KEY,
    THINKING_OFF_STORAGE_KEY,
    CONTEXT_CHOICE_STORAGE_KEY,
  ]);
  const services = normalizeStoredCustomServices(stored[CUSTOM_SERVICES_STORAGE_KEY]);
  return {
    services,
    activeId: readActiveId(stored[ACTIVE_CUSTOM_MODEL_STORAGE_KEY], services),
    thinkingOff: readThinkingOff(stored[THINKING_OFF_STORAGE_KEY], services),
    contextChoice: readContextChoice(stored[CONTEXT_CHOICE_STORAGE_KEY], services),
  };
});

const customModelSlice = createSlice({
  name: 'customModel',
  initialState,
  reducers: {
    /** 来自存储订阅，不再回写，避免两个文档互相触发。 */
    hydrateCustomModels(
      state,
      action: PayloadAction<{
        services?: unknown;
        activeId?: unknown;
        thinkingOff?: unknown;
        contextChoice?: unknown;
        hasServices: boolean;
        hasActive: boolean;
        hasThinkingOff?: boolean;
        hasContextChoice?: boolean;
      }>
    ) {
      if (action.payload.hasServices) {
        state.services = normalizeStoredCustomServices(action.payload.services);
      }
      if (action.payload.hasActive) {
        state.activeId = readActiveId(action.payload.activeId, state.services);
      } else if (state.activeId && !hasModel(state.services, state.activeId)) {
        state.activeId = null;
      }
      if (action.payload.hasThinkingOff) {
        state.thinkingOff = readThinkingOff(action.payload.thinkingOff, state.services);
      } else {
        state.thinkingOff = readThinkingOff(state.thinkingOff, state.services);
      }
      state.contextChoice = readContextChoice(
        action.payload.hasContextChoice ? action.payload.contextChoice : state.contextChoice,
        state.services
      );
      state.loaded = true;
    },
    upsertCustomService(state, action: PayloadAction<CustomService>) {
      const index = state.services.findIndex((service) => service.id === action.payload.id);
      if (index === -1) state.services.push(action.payload);
      else state.services[index] = action.payload;
      // 编辑时可能删掉了当前选中的那个模型。
      if (state.activeId && !hasModel(state.services, state.activeId)) state.activeId = null;
      state.thinkingOff = readThinkingOff(state.thinkingOff, state.services);
      state.contextChoice = readContextChoice(state.contextChoice, state.services);
    },
    deleteCustomService(state, action: PayloadAction<string>) {
      state.services = state.services.filter((service) => service.id !== action.payload);
      if (state.activeId && !hasModel(state.services, state.activeId)) state.activeId = null;
      state.thinkingOff = readThinkingOff(state.thinkingOff, state.services);
      state.contextChoice = readContextChoice(state.contextChoice, state.services);
    },
    activateCustomModel(state, action: PayloadAction<string | null>) {
      state.activeId = hasModel(state.services, action.payload) ? action.payload : null;
    },
    changeThinking(state, action: PayloadAction<{ id: string; enabled: boolean }>) {
      const { id, enabled } = action.payload;
      if (!hasModel(state.services, id)) return;
      const rest = state.thinkingOff.filter((item) => item !== id);
      state.thinkingOff = enabled ? rest : [...rest, id];
    },
    changeContext(state, action: PayloadAction<{ id: string; tokens: number }>) {
      const { id, tokens } = action.payload;
      if (!hasModel(state.services, id)) return;
      state.contextChoice[id] = tokens;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeCustomModels.fulfilled, (state, action) => {
      state.services = action.payload.services;
      state.activeId = action.payload.activeId;
      state.thinkingOff = action.payload.thinkingOff;
      state.contextChoice = action.payload.contextChoice;
      state.loaded = true;
    });
  },
});

const {
  upsertCustomService,
  deleteCustomService,
  activateCustomModel,
  changeThinking,
  changeContext,
} = customModelSlice.actions;
export const { hydrateCustomModels } = customModelSlice.actions;

function persistServices(state: RootState) {
  return storageSet('local', { [CUSTOM_SERVICES_STORAGE_KEY]: state.customModel.services });
}

function persistActive(state: RootState) {
  return storageSet('local', { [ACTIVE_CUSTOM_MODEL_STORAGE_KEY]: state.customModel.activeId });
}

function persistThinking(state: RootState) {
  return storageSet('local', { [THINKING_OFF_STORAGE_KEY]: state.customModel.thinkingOff });
}

function persistContext(state: RootState) {
  return storageSet('local', { [CONTEXT_CHOICE_STORAGE_KEY]: state.customModel.contextChoice });
}

function contextChanged(before: Record<string, number>, after: Record<string, number>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].some((key) => before[key] !== after[key]);
}

function thinkingChanged(before: string[], after: string[]) {
  return before.length !== after.length || before.some((id, index) => id !== after[index]);
}

export const saveCustomService =
  (service: CustomService): AppThunk =>
  async (dispatch, getState) => {
    const before = getState().customModel;
    dispatch(upsertCustomService(service));
    const next = getState();
    await persistServices(next);
    if (before.activeId !== next.customModel.activeId) await persistActive(next);
    if (thinkingChanged(before.thinkingOff, next.customModel.thinkingOff)) {
      await persistThinking(next);
    }
    if (contextChanged(before.contextChoice, next.customModel.contextChoice)) {
      await persistContext(next);
    }
  };

export const removeCustomService =
  (id: string): AppThunk =>
  async (dispatch, getState) => {
    const before = getState().customModel;
    dispatch(deleteCustomService(id));
    const next = getState();
    await persistServices(next);
    if (before.activeId !== next.customModel.activeId) await persistActive(next);
    if (thinkingChanged(before.thinkingOff, next.customModel.thinkingOff)) {
      await persistThinking(next);
    }
    if (contextChanged(before.contextChoice, next.customModel.contextChoice)) {
      await persistContext(next);
    }
  };

/** 传 null 表示切回 Ollama。 */
export const setActiveCustomModel =
  (id: string | null): AppThunk =>
  async (dispatch, getState) => {
    if (getState().customModel.activeId === (id ?? null)) return;
    dispatch(activateCustomModel(id));
    await persistActive(getState());
  };

/** enabled 为 false 表示这个模型发请求时显式关闭思考。 */
export const setCustomModelThinking =
  (id: string, enabled: boolean): AppThunk =>
  async (dispatch, getState) => {
    const before = getState().customModel.thinkingOff;
    dispatch(changeThinking({ id, enabled }));
    const next = getState();
    if (thinkingChanged(before, next.customModel.thinkingOff)) await persistThinking(next);
  };

/** 选择某个模型使用的上下文窗口。值应是该服务可选项之一，不在时读取侧会忽略。 */
export const setCustomModelContext =
  (id: string, tokens: number): AppThunk =>
  async (dispatch, getState) => {
    const before = getState().customModel.contextChoice;
    dispatch(changeContext({ id, tokens }));
    const next = getState();
    if (contextChanged(before, next.customModel.contextChoice)) await persistContext(next);
  };

export default customModelSlice;
