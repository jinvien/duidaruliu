import { createSlice, PayloadAction, current } from '@reduxjs/toolkit';
import { storeCurrentMessagesFunc } from './historySlice';

// waiting 接口尚未响应 | outputting 流式输出中 | end 输出结束
export type ResponseStatus = 'waiting' | 'outputting' | 'end';

export type RoleType = 'user' | 'assistant' | 'system' | 'tool';
// 消息类型
export type Message = {
  role: RoleType;
  content: string;
  createdAt: number;
  model?: string;
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
      state.messages[state.messages.length - 1].content = action.payload;
    },
  },
});

export const { setMessages, addMessage, updateLastMessage, setResponseStatus } = chatSlice.actions;
export default chatSlice;
