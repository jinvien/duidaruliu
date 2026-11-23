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
  loaded: boolean;
};

type AppThunk = ThunkAction<Promise<void>, RootState, unknown, UnknownAction>;

const initialState: CustomModelState = {
  services: [],
  activeId: null,
  loaded: false,
};

// 含 API Key，只放 local，不进会随账号同步的 sync。
export const CUSTOM_SERVICES_STORAGE_KEY = 'customServices';
export const ACTIVE_CUSTOM_MODEL_STORAGE_KEY = 'activeCustomModelId';

function hasModel(services: CustomService[], id: unknown): id is string {
  return typeof id === 'string' && expandCustomServices(services).some((model) => model.id === id);
}

function readActiveId(raw: unknown, services: CustomService[]): string | null {
  return hasModel(services, raw) ? raw : null;
}

export const initializeCustomModels = createAsyncThunk('customModel/initialize', async () => {
  const stored = await storageGet('local', [
    CUSTOM_SERVICES_STORAGE_KEY,
    ACTIVE_CUSTOM_MODEL_STORAGE_KEY,
  ]);
  const services = normalizeStoredCustomServices(stored[CUSTOM_SERVICES_STORAGE_KEY]);
  return { services, activeId: readActiveId(stored[ACTIVE_CUSTOM_MODEL_STORAGE_KEY], services) };
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
        hasServices: boolean;
        hasActive: boolean;
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
      state.loaded = true;
    },
    upsertCustomService(state, action: PayloadAction<CustomService>) {
      const index = state.services.findIndex((service) => service.id === action.payload.id);
      if (index === -1) state.services.push(action.payload);
      else state.services[index] = action.payload;
      // 编辑时可能删掉了当前选中的那个模型。
      if (state.activeId && !hasModel(state.services, state.activeId)) state.activeId = null;
    },
    deleteCustomService(state, action: PayloadAction<string>) {
      state.services = state.services.filter((service) => service.id !== action.payload);
      if (state.activeId && !hasModel(state.services, state.activeId)) state.activeId = null;
    },
    activateCustomModel(state, action: PayloadAction<string | null>) {
      state.activeId = hasModel(state.services, action.payload) ? action.payload : null;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeCustomModels.fulfilled, (state, action) => {
      state.services = action.payload.services;
      state.activeId = action.payload.activeId;
      state.loaded = true;
    });
  },
});

const { upsertCustomService, deleteCustomService, activateCustomModel } = customModelSlice.actions;
export const { hydrateCustomModels } = customModelSlice.actions;

function persistServices(state: RootState) {
  return storageSet('local', { [CUSTOM_SERVICES_STORAGE_KEY]: state.customModel.services });
}

function persistActive(state: RootState) {
  return storageSet('local', { [ACTIVE_CUSTOM_MODEL_STORAGE_KEY]: state.customModel.activeId });
}

export const saveCustomService =
  (service: CustomService): AppThunk =>
  async (dispatch, getState) => {
    const before = getState().customModel.activeId;
    dispatch(upsertCustomService(service));
    const next = getState();
    await persistServices(next);
    if (before !== next.customModel.activeId) await persistActive(next);
  };

export const removeCustomService =
  (id: string): AppThunk =>
  async (dispatch, getState) => {
    const before = getState().customModel.activeId;
    dispatch(deleteCustomService(id));
    const next = getState();
    await persistServices(next);
    if (before !== next.customModel.activeId) await persistActive(next);
  };

/** 传 null 表示切回 Ollama。 */
export const setActiveCustomModel =
  (id: string | null): AppThunk =>
  async (dispatch, getState) => {
    if (getState().customModel.activeId === (id ?? null)) return;
    dispatch(activateCustomModel(id));
    await persistActive(getState());
  };

export default customModelSlice;
