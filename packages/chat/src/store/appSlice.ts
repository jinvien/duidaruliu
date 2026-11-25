import { storageGet, storageSet } from '../host';
// app.slice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import i18n from '../i18n';

export type AppState = {
  isDarkMode: boolean;
  lang: string;
};

const initialState: AppState = {
  isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
  lang: navigator.language,
};

// 异步获取存储数据
export const initializeApp = createAsyncThunk('app/initialize', async () => {
  const { appSettings } = await storageGet('sync', 'appSettings');
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
      storageSet('sync', {
        appSettings: { ...state, isDarkMode },
      });
    },
    updateAppSettings(state, action: PayloadAction<AppState>) {
      // 语言切换
      if (state.lang !== action.payload.lang) {
        i18n.changeLanguage(action.payload.lang);
      }

      storageSet('sync', {
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
