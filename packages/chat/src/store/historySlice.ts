import { storageGet, storageSet } from '../host';
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { message } from 'antd';
import { normalizeStoredMessage } from '../utils/chatImage';
import i18n from '../i18n';
import type { Message } from './chatSlice';

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
  try {
    const { historyConversations } = await storageGet('local', 'historyConversations');
    const stored = Array.isArray(historyConversations) ? historyConversations : [];
    const newHistoryConversations = [
      {
        messages,
        lastUpdatedAt: Date.now(),
        lastModel: messages[messages.length - 1]?.model,
      },
      ...stored,
    ];

    await storageSet('local', {
      historyConversations: newHistoryConversations,
    });

    return newHistoryConversations;
  } catch (error) {
    console.error('store history failed', error);
    message.error(i18n.t('chat.historySaveFailed'));
    return undefined;
  }
};

// 异步获取存储数据
export const storeCurrentMessages = createAsyncThunk('history/store', storeCurrentMessagesFunc);

export function normalizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.messages)) return null;

  const messages = value.messages
    .map(normalizeStoredMessage)
    .filter((message): message is Message => message !== null);
  if (!messages.length) return null;

  const conversation: Conversation = {
    lastModel: typeof value.lastModel === 'string' ? value.lastModel : '',
    lastUpdatedAt:
      typeof value.lastUpdatedAt === 'number' && Number.isFinite(value.lastUpdatedAt)
        ? value.lastUpdatedAt
        : messages[messages.length - 1].createdAt,
    messages,
  };
  if (typeof value.exportedAt === 'number') {
    conversation.exportedAt = value.exportedAt;
  }
  return conversation;
}

// 异步获取存储数据。只规范化内存中的副本，不改写旧的本地记录。
export const initializeConversations = createAsyncThunk('history/initialize', async () => {
  const { historyConversations } = await storageGet('local', 'historyConversations');
  if (!Array.isArray(historyConversations)) return [] as Conversation[];
  return historyConversations
    .map(normalizeConversation)
    .filter((item): item is Conversation => item !== null);
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
        state.conversations = action.payload
          .map(normalizeConversation)
          .filter((item): item is Conversation => item !== null);
      }
    });
    builder.addCase(initializeConversations.fulfilled, (state, action) => {
      state.conversations = action.payload;
    });
  },
});

export const { setIsViewHistoryMode, setIsShowHistoryPanel } = historySlice.actions;
export default historySlice;
