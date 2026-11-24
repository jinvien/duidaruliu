import { configureStore } from '@reduxjs/toolkit';
import appSlice from './appSlice';
import chatSlice from './chatSlice';
import ollamaSlice from './ollamaSlice';
import customModelSlice from './customModelSlice';
import historySlice from './historySlice';
import quickCommandSlice from './quickCommandSlice';
import mcpSlice from './mcpSlice';
import pageSlice from './pageSlice';

// 创建 store
const store = configureStore({
  reducer: {
    app: appSlice.reducer,
    chat: chatSlice.reducer,
    ollama: ollamaSlice.reducer,
    customModel: customModelSlice.reducer,
    history: historySlice.reducer,
    quickCommand: quickCommandSlice.reducer,
    mcp: mcpSlice.reducer,
    page: pageSlice.reducer,
  },
});

// 导出类型化的 RootState 和 Dispatch
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// 导出 store
export default store;
