// app.slice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import i18n from '@/i18n';

type AppState = {
  isDarkMode: boolean;
  lang: string;
};

const initialState: AppState = {
  isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
  lang: navigator.language,
};

// 异步获取存储数据
export const initializeApp = createAsyncThunk('app/initialize', async () => {
  const { appSettings } = await chrome.storage.sync.get('appSettings');
  const isDarkMode = appSettings?.isDarkMode ?? initialState.isDarkMode;
  return {
    ...appSettings,
    isDarkMode,
  };
});

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    toggleTheme(state, action: PayloadAction<boolean | undefined>) {
      const isDarkMode = action.payload ?? !state.isDarkMode;
      state.isDarkMode = isDarkMode;
      chrome.storage.sync.set({
        appSettings: { ...state, isDarkMode },
      });
    },
    updateAppSettings(state, action: PayloadAction<AppState>) {
      // 语言切换
      if (state.lang !== action.payload.lang) {
        i18n.changeLanguage(action.payload.lang);
      }

      chrome.storage.sync.set({
        appSettings: action.payload,
      });
      Object.assign(state, action.payload);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeApp.fulfilled, (state, action) => {
      Object.assign(state, action.payload);
    });
  },
});

export const { toggleTheme, updateAppSettings } = appSlice.actions;

export default appSlice;
