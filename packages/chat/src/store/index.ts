import { configureStore } from '@reduxjs/toolkit';
import appSlice from './appSlice';
import chatSlice from './chatSlice';
import ollamaSlice from './ollamaSlice';
import customModelSlice from './customModelSlice';
import historySlice from './historySlice';
import promptSlice from './promptSlice';
import mcpSlice from './mcpSlice';

// 创建 store
const store = configureStore({
  reducer: {
    app: appSlice.reducer,
    chat: chatSlice.reducer,
    ollama: ollamaSlice.reducer,
    customModel: customModelSlice.reducer,
    history: historySlice.reducer,
    prompt: promptSlice.reducer,
    mcp: mcpSlice.reducer,
  },
});

// 导出类型化的 RootState 和 Dispatch
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// 导出 store
export default store;
