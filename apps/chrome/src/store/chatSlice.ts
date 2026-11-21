import { createSlice, PayloadAction, current } from '@reduxjs/toolkit';
import { storeCurrentMessagesFunc } from './historySlice';

// waiting 接口尚未响应 | outputting 流式输出中 | end 输出结束
export type ResponseStatus = 'waiting' | 'outputting' | 'end';

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
};

const initialState: {
  messages: Message[];
  responseStatus: ResponseStatus;
} = {
  messages: [],
  responseStatus: 'end',
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
    },
    updateLastMessage: (state, action: PayloadAction<string>) => {
      const last = state.messages[state.messages.length - 1];
      // 进行中的回复被换成用户消息或清空后，不能把增量写进去。
      if (!last || last.role !== 'assistant') return;
      last.content = action.payload;
    },
  },
});

export const { setMessages, addMessage, updateLastMessage, setResponseStatus } = chatSlice.actions;
export default chatSlice;
