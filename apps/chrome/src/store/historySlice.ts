import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import type { Message } from '@/store/chatSlice';

export type Conversation = {
  lastModel: string;
  lastUpdatedAt: number;
  exportedAt?: number;
  messages: Message[];
};

const initialState: {
  conversations: Conversation[];
  isViewHistoryMode: boolean;
  isShowHistoryPanel: boolean;
} = {
  conversations: [],
  isViewHistoryMode: false,
  isShowHistoryPanel: false,
};

// 异步获取存储数据
export const storeCurrentMessagesFunc = async (messages: Message[]) => {
  if (!messages.length) {
    return;
  }
  const { historyConversations } = await chrome.storage.local.get('historyConversations');
  const newHistoryConversations = [
    {
      messages,
      lastUpdatedAt: Date.now(),
      lastModel: messages[messages.length - 1]?.model,
    },
    ...historyConversations,
  ];

  await chrome.storage.local.set({
    historyConversations: newHistoryConversations,
  });

  return newHistoryConversations;
};

// 异步获取存储数据
export const storeCurrentMessages = createAsyncThunk('history/store', storeCurrentMessagesFunc);

// 异步获取存储数据
export const initializeConversations = createAsyncThunk('history/initialize', async () => {
  const { historyConversations } = await chrome.storage.local.get('historyConversations');
  return historyConversations;
});

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    setIsViewHistoryMode(state, action: PayloadAction<boolean>) {
      state.isViewHistoryMode = action.payload;
    },
    setIsShowHistoryPanel(state, action: PayloadAction<boolean>) {
      state.isShowHistoryPanel = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(storeCurrentMessages.fulfilled, (state, action) => {
      if (action.payload) {
        state.conversations = action.payload;
      }
    });
    builder.addCase(initializeConversations.fulfilled, (state, action) => {
      state.conversations = action.payload;
    });
  },
});

export const { setIsViewHistoryMode, setIsShowHistoryPanel } = historySlice.actions;
export default historySlice;
