import { getServiceFetch, storageGet, storageSet } from '../host';
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';

import type { OllamaModelParams } from '../hooks/useOllama';
import type { CapabilityState, OllamaListedModel } from '../utils/modelCapability';

export type OllamaSetting = {
  ollamaUrl: string;
  ollamaIsRunning: boolean;
  /** 最近一次连通检查的失败原因。成功时为空。 */
  serviceError: string;
  ollamaModelParams: OllamaModelParams;
  listedModels: OllamaListedModel[];
  /** tags/show 的整体进度。loading 时缺能力不能显示成已确认无视觉。 */
  modelsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** 增加后重新拉模型列表，地址没变也能重试。 */
  modelsNonce: number;
};

const initialState: OllamaSetting = {
  ollamaUrl: '',
  ollamaIsRunning: false,
  serviceError: '',
  ollamaModelParams: { model: '' },
  listedModels: [],
  modelsStatus: 'idle',
  modelsNonce: 0,
};

async function failureDetail(response: Response): Promise<string> {
  let detail = '';
  try {
    detail = (await response.text()).trim();
  } catch {
    detail = '';
  }
  if (detail.length > 180) detail = `${detail.slice(0, 180)}…`;
  return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
}

// 检查 Ollama 服务状态。根路径返回 200 才算连通，失败原因留给界面。
export const checkOllamaStatus = createAsyncThunk('ollama/checkOllama', async (url: string) => {
  if (!url) return { ok: false, detail: 'missing url' };
  try {
    const response = await getServiceFetch()(`${url.replace(/\/$/, '')}/`);
    if (!response.ok) return { ok: false, detail: await failureDetail(response) };
    return { ok: true, detail: '' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: detail || 'network error' };
  }
});

// 异步获取存储数据
export const initializeOllama = createAsyncThunk('ollama/initialize', async (_, thunkAPI) => {
  const [ollamaModelParams, ollamaSettings] = await Promise.all([
    storageGet('sync', 'ollamaModelParams'),
    storageGet('sync', 'ollamaSettings'),
  ]);

  thunkAPI.dispatch(checkOllamaStatus(ollamaSettings.ollamaSettings?.url));

  return {
    ollamaModelParams: ollamaModelParams.ollamaModelParams ?? initialState.ollamaModelParams,
    ollamaUrl: ollamaSettings.ollamaSettings?.url ?? initialState.ollamaUrl,
  };
});

const ollamaSlice = createSlice({
  name: 'ollama',
  initialState,
  reducers: {
    setOllamaModelParams(state, action: PayloadAction<OllamaModelParams>) {
      state.ollamaModelParams = action.payload;
      storageSet('sync', { ollamaModelParams: action.payload });
    },
    setOllamaUrl(state, action: PayloadAction<string>) {
      state.ollamaUrl = action.payload;
      storageSet('sync', { ollamaSettings: { url: action.payload } });
    },
    setListedModels(state, action: PayloadAction<OllamaListedModel[]>) {
      state.listedModels = action.payload;
    },
    setModelsStatus(state, action: PayloadAction<'idle' | 'loading' | 'ready' | 'error'>) {
      state.modelsStatus = action.payload;
    },
    bumpModelsNonce(state) {
      state.modelsNonce += 1;
    },
    setModelCapabilities(
      state,
      action: PayloadAction<{
        name: string;
        capabilities: string[];
        capabilityState: CapabilityState;
      }>
    ) {
      const model = state.listedModels.find((item) => item.name === action.payload.name);
      if (!model) return;
      model.capabilities = action.payload.capabilities;
      model.capabilityState = action.payload.capabilityState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeOllama.fulfilled, (state, action) => {
        Object.assign(state, action.payload);
      })
      .addCase(checkOllamaStatus.fulfilled, (state, action) => {
        state.ollamaIsRunning = action.payload.ok;
        state.serviceError = action.payload.detail;
      });
  },
});

export const {
  setOllamaModelParams,
  setOllamaUrl,
  setListedModels,
  setModelsStatus,
  bumpModelsNonce,
  setModelCapabilities,
} = ollamaSlice.actions;

export default ollamaSlice;
