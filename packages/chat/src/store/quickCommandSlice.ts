import { storageGet } from '../host';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeQuickCommands, type QuickCommandCategory } from '../utils/quickCommand';

type QuickCommandState = {
  categories: QuickCommandCategory[];
};

const initialState: QuickCommandState = {
  categories: [],
};

export const initializeQuickCommands = createAsyncThunk('quickCommand/initialize', async () => {
  const { quickCommands } = await storageGet('sync', 'quickCommands');
  return normalizeQuickCommands(quickCommands, navigator.language);
});

const quickCommandSlice = createSlice({
  name: 'quickCommand',
  initialState,
  reducers: {
    /** 设置页保存后，存储变化会通过它同步到已经打开的聊天页。 */
    setQuickCommands(state, action: PayloadAction<unknown>) {
      state.categories = normalizeQuickCommands(action.payload, navigator.language);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeQuickCommands.fulfilled, (state, action) => {
      state.categories = action.payload;
    });
  },
});

export const { setQuickCommands } = quickCommandSlice.actions;

export default quickCommandSlice;
