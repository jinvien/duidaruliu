import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';

import type { OllamaModelParams } from '@/hooks/useOllama';

export type OllamaSetting = {
  ollamaUrl: string;
  ollamaIsRunning: boolean;
  ollamaModelParams: OllamaModelParams;
};

const initialState: OllamaSetting = {
  ollamaUrl: '',
  ollamaIsRunning: false,
  ollamaModelParams: { model: '' },
};

// 检查 Ollama 服务状态
const checkOllamaStatus = createAsyncThunk('ollama/checkOllama', async (url: string) => {
  try {
    const response = await fetch(`${url}/`);
    return response.ok;
  } catch (e) {
    return false;
  }
});

// 异步获取存储数据
export const initializeOllama = createAsyncThunk('ollama/initialize', async (_, thunkAPI) => {
  const [ollamaModelParams, ollamaSettings] = await Promise.all([
    chrome.storage.sync.get('ollamaModelParams'),
    chrome.storage.sync.get('ollamaSettings'),
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
      chrome.storage.sync.set({ ollamaModelParams: action.payload });
    },
    setOllamaUrl(state, action: PayloadAction<string>) {
      state.ollamaUrl = action.payload;
      chrome.storage.sync.set({ ollamaSettings: { url: action.payload } });
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeOllama.fulfilled, (state, action) => {
        Object.assign(state, action.payload);
      })
      .addCase(checkOllamaStatus.fulfilled, (state, action) => {
        state.ollamaIsRunning = action.payload;
      });
  },
});

export const { setOllamaModelParams, setOllamaUrl } = ollamaSlice.actions;

export default ollamaSlice;
