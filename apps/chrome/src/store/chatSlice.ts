import { createSlice, PayloadAction, current } from '@reduxjs/toolkit';
import { storeCurrentMessagesFunc } from './historySlice';

// waiting 接口尚未响应 | outputting 流式输出中 | tool 工具执行中 | end 输出结束
export type ResponseStatus = 'waiting' | 'outputting' | 'tool' | 'end';

export type ToolCallRecord = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type RoleType = 'user' | 'assistant' | 'system' | 'tool';

/** 本地展示与历史用的图片。发给 Ollama 时去掉 data URL 前缀。 */
export type ChatImage = {
  dataUrl: string;
};

// 消息类型。content 保持字符串，旧历史没有 images 也能读。
export type Message = {
  role: RoleType;
  content: string;
  createdAt: number;
  model?: string;
  images?: ChatImage[];
  thinking?: string;
  toolCalls?: ToolCallRecord[];
  toolCallId?: string;
  toolName?: string;
  /** 气泡上的名字。回放仍用 toolName。 */
  toolDisplayName?: string;
  isError?: boolean;
};

export type PendingTool = {
  id: string;
  name: string;
  displayName?: string;
  argumentsText: string;
};

const initialState: {
  messages: Message[];
  responseStatus: ResponseStatus;
  pendingTool: PendingTool | null;
} = {
  messages: [],
  responseStatus: 'end',
  pendingTool: null,
};

const chatSlice = createSlice({
  name: 'messages',
  initialState,
  reducers: {
    setResponseStatus: (state, action: PayloadAction<ResponseStatus>) => {
      state.responseStatus = action.payload;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload);
    },
    setMessages: (
      state,
      action: PayloadAction<{ messages: Message[]; isSaveCurrent?: boolean }>
    ) => {
      const { messages, isSaveCurrent } = action.payload;
      const currentMessages = current(state.messages);
      if (isSaveCurrent && currentMessages.length) {
        storeCurrentMessagesFunc(currentMessages);
      }
      state.messages = messages;
      state.pendingTool = null;
    },
    updateLastMessage: (state, action: PayloadAction<string>) => {
      const last = state.messages[state.messages.length - 1];
      // 进行中的回复被换成用户消息或清空后，不能把增量写进去。
      if (!last || last.role !== 'assistant') return;
      last.content = action.payload;
    },
    patchLastAssistant: (
      state,
      action: PayloadAction<{ thinking?: string; toolCalls?: ToolCallRecord[] }>
    ) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return;
      if (action.payload.thinking) last.thinking = action.payload.thinking;
      if (action.payload.toolCalls?.length) last.toolCalls = action.payload.toolCalls;
    },
    setPendingTool: (state, action: PayloadAction<PendingTool | null>) => {
      state.pendingTool = action.payload;
    },
  },
});

export const {
  setMessages,
  addMessage,
  updateLastMessage,
  patchLastAssistant,
  setPendingTool,
  setResponseStatus,
} = chatSlice.actions;
export default chatSlice;
