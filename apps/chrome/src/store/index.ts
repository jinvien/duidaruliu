import { configureStore } from '@reduxjs/toolkit';
import appSlice from './appSlice';
import chatSlice from './chatSlice';
import ollamaSlice from './ollamaSlice';
import historySlice from './historySlice';
import promptSlice from './promptSlice';

// 创建 store
const store = configureStore({
  reducer: {
    app: appSlice.reducer,
    chat: chatSlice.reducer,
    ollama: ollamaSlice.reducer,
    history: historySlice.reducer,
    prompt: promptSlice.reducer,
  },
});

// 导出类型化的 RootState 和 Dispatch
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// 导出 store
export default store;
