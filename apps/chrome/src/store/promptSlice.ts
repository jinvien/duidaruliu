import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';

type PromptState = {
  label: string;
  value: string;
  type: 'system' | 'quick';
};

const initialState: PromptState[] = [];

// 异步获取存储数据
export const initializePrompts = createAsyncThunk('prompt/initialize', async () => {
  const { customPrompts } = await chrome.storage.sync.get('customPrompts');
  return customPrompts;
});

const promptSlice = createSlice({
  name: 'prompt',
  initialState,
  reducers: {
    updateCustomPrompts(state, action: PayloadAction<PromptState>) {
      chrome.storage.sync.set({
        customPrompts: action.payload,
      });
      Object.assign(state, action.payload);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializePrompts.fulfilled, (state, action) => {
      Object.assign(state, action.payload);
    });
  },
});

export const { updateCustomPrompts } = promptSlice.actions;

export default promptSlice;
