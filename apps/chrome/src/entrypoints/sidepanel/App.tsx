import React, { useState, useEffect } from 'react';
import { App as AntdApp } from 'antd';

// pages
import Iframe from '@/pages/iframe';
import Chat from '@/pages/chat';
import Setting from '@/pages/setting';

// slices
import { toggleTheme, updateAppSettings, initializeApp } from '@/store/appSlice';
import { initializePrompts } from '@/store/promptSlice';
import { initializeOllama, setOllamaModelParams, setOllamaUrl } from '@/store/ollamaSlice';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';

// tools
import { rewriteOrigin } from '@/utils/rewriteOrigin';

// constants
import { SYNC_VALUE_CHANGED } from '@/constants/command';

// types
import type { Dispatch, SetStateAction } from 'react';
import type { StorageChangeMessage } from '@/entrypoints/background';

type AppMode = 'chat' | 'setting' | string;
export type SetAppMode = Dispatch<SetStateAction<AppMode>>;

const syncKeys = ['appSettings', 'ollamaModelParams', 'ollamaSettings'];

type SidePanelMainProps = {
  setAppMode: SetAppMode;
  appMode: AppMode;
};

// 从 url query参数中获取 appMode
const getAppModeFromUrl = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('appMode') as AppMode;
};

const SidePanelMain: React.FC<SidePanelMainProps> = (props) => {
  const dispatch = useAppDispatch();

  //props
  const { setAppMode, appMode } = props;

  //  监听 chrome sync 配置更新事件
  const handleStorageChange = (bgMessage: StorageChangeMessage) => {
    const { type, key, payload } = bgMessage;
    if (type !== SYNC_VALUE_CHANGED || !syncKeys.includes(key)) {
      return;
    }

    switch (key) {
      case 'appSettings':
        dispatch(updateAppSettings(payload));
        break;
      case 'ollamaModelParams':
        dispatch(setOllamaModelParams(payload));
        break;
      case 'ollamaSettings':
        dispatch(setOllamaUrl(payload.url));
        dispatch(initializeOllama());
        break;
    }
  };

  useEffect(() => {
    // 主题深浅色跟随系统设置切换
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e: MediaQueryListEvent) => {
      dispatch(toggleTheme(e.matches));
    };
    mediaQuery.addEventListener('change', handleThemeChange);

    // 从 url 中获取 appMode
    const appMode = getAppModeFromUrl();
    if (appMode) {
      setAppMode(appMode);
    }

    // 监听 chrome sync 配置更新事件
    chrome.runtime.onMessage.addListener(handleStorageChange);
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
      chrome.runtime.onMessage.removeListener(handleStorageChange);
    };
  }, []);

  const renderContent = () => {
    // 如果 appMode 是url，则渲染iframe
    const isUrlReg = /^https?:\/\//;
    if (isUrlReg.test(appMode)) {
      return <Iframe setAppMode={setAppMode} url={appMode} />;
    }

    switch (appMode) {
      case 'chat':
        return <Chat setAppMode={setAppMode} />;
      case 'setting':
        return <Setting />;
      default:
        return <div>404</div>;
    }
  };

  return renderContent();
};

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>('chat');
  const dispatch = useAppDispatch();

  useEffect(() => {
    // 初始化 ollama 数据，包括 ollamaUrl 等
    dispatch(initializeOllama());

    // 初始化 app 数据，包括主题等
    dispatch(initializeApp());

    // 初始化提示词
    dispatch(initializePrompts());
  }, [dispatch]);

  const { ollamaUrl } = useAppSelector((state) => state.ollama);
  if (!ollamaUrl) {
    return null;
  }

  // 利用插件能力重写 origin，解决跨域问题
  rewriteOrigin(ollamaUrl);
  return (
    <AntdApp message={{ top: 57 }}>
      <SidePanelMain setAppMode={setAppMode} appMode={appMode} />
    </AntdApp>
  );
};

export default App;
