import React, { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { App as AntdApp, theme } from 'antd';
import { XProvider } from '@ant-design/x';

import Iframe from '../pages/iframe';
import Chat from '../pages/chat';
import Setting from '../pages/setting';
import store from '../store';
import { toggleTheme, updateAppSettings, initializeApp, type AppState } from '../store/appSlice';
import { initializeQuickCommands, setQuickCommands } from '../store/quickCommandSlice';
import { initializeOllama, setOllamaModelParams, setOllamaUrl } from '../store/ollamaSlice';
import {
  ACTIVE_CUSTOM_MODEL_STORAGE_KEY,
  CUSTOM_SERVICES_STORAGE_KEY,
  hydrateCustomModels,
  THINKING_OFF_STORAGE_KEY,
  CONTEXT_CHOICE_STORAGE_KEY,
  initializeCustomModels,
} from '../store/customModelSlice';
import { selectCombinedModels, selectSelectedModelKey } from '../models/selection';
import type { OllamaModelParams } from '../hooks/useOllama';
import { initializeMcp, setMcpServers, setMcpToolsEnabled } from '../store/mcpSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useStore';
import { refreshAgentTools } from '../agent/runtime';
import { readMcpLocalChange } from '../mcp/page';
import { closeMcpSessions, syncMcpSessions } from '../mcp/session';
import { getChatHost } from '../host';
import { loadStoredLanguage } from '../i18n';
import { seedStorageDefaults } from '../storage/seed';
import { ChatLayoutProvider } from './layout';
import { appModeFromLocation, SHELL_MODE_EVENT, type AppMode, type SetAppMode } from './types';

import './main.less';

const { darkAlgorithm, defaultAlgorithm } = theme;

type ChatRootProps = {
  /** 这份文档是否持有 MCP 连接。扩展设置页是另一个文档，不持有。 */
  ownsRuntime: boolean;
  /** 扩展在卸载时清掉自己的 Origin 规则。 */
  onRuntimeStop?: () => Promise<void> | void;
};

const SidePanelMain: React.FC<{ setAppMode: SetAppMode; appMode: AppMode }> = ({
  setAppMode,
  appMode,
}) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (event: MediaQueryListEvent) => {
      dispatch(toggleTheme(event.matches));
    };
    mediaQuery.addEventListener('change', handleThemeChange);

    const readMode = () => {
      const next = new URLSearchParams(window.location.search).get('appMode');
      if (next) setAppMode(next);
    };
    window.addEventListener(SHELL_MODE_EVENT, readMode);
    window.addEventListener('popstate', readMode);

    const unsubscribe = getChatHost().storage.subscribe((changes, area) => {
      // 自定义模型含 API Key，放在 local。设置页和聊天页不在同一份文档时靠这里同步。
      if (area === 'local') {
        const services = changes[CUSTOM_SERVICES_STORAGE_KEY];
        const active = changes[ACTIVE_CUSTOM_MODEL_STORAGE_KEY];
        const thinkingOff = changes[THINKING_OFF_STORAGE_KEY];
        const contextChoice = changes[CONTEXT_CHOICE_STORAGE_KEY];
        if (services || active || thinkingOff || contextChoice) {
          dispatch(
            hydrateCustomModels({
              services: services?.newValue,
              activeId: active?.newValue,
              thinkingOff: thinkingOff?.newValue,
              hasServices: Boolean(services),
              hasActive: Boolean(active),
              hasThinkingOff: Boolean(thinkingOff),
              contextChoice: contextChoice?.newValue,
              hasContextChoice: Boolean(contextChoice),
            })
          );
        }
        return;
      }
      if (area !== 'sync') return;
      if (changes.appSettings?.newValue) {
        dispatch(updateAppSettings(changes.appSettings.newValue as AppState));
      }
      if (changes.ollamaModelParams?.newValue) {
        dispatch(setOllamaModelParams(changes.ollamaModelParams.newValue as OllamaModelParams));
      }
      const settings = changes.ollamaSettings?.newValue as { url?: string } | undefined;
      if (settings?.url) {
        dispatch(setOllamaUrl(settings.url));
        dispatch(initializeOllama());
      }
    });

    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
      window.removeEventListener(SHELL_MODE_EVENT, readMode);
      window.removeEventListener('popstate', readMode);
      unsubscribe();
    };
  }, [dispatch, setAppMode]);

  if (/^https?:\/\//.test(appMode)) {
    return <Iframe setAppMode={setAppMode} url={appMode} />;
  }
  if (appMode === 'setting') return <Setting setAppMode={setAppMode} />;
  if (appMode === 'chat') return <Chat setAppMode={setAppMode} />;
  return <div>404</div>;
};

const ThemedApp: React.FC<ChatRootProps> = ({ ownsRuntime, onRuntimeStop }) => {
  const dispatch = useAppDispatch();
  const { isDarkMode } = useAppSelector((state) => state.app);
  const [appMode, setAppMode] = useState<AppMode>(() => appModeFromLocation());
  const setMode: SetAppMode = (value) => {
    setAppMode((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      if ((next === 'chat' || next === 'setting') && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (next === 'chat') url.searchParams.delete('appMode');
        else url.searchParams.set('appMode', 'setting');
        const nextSearch = `${url.pathname}${url.search}`;
        const currentSearch = `${window.location.pathname}${window.location.search}`;
        if (nextSearch !== currentSearch) window.history.pushState({}, '', url);
      }
      return next;
    });
  };
  const { ollamaUrl } = useAppSelector((state) => state.ollama);
  const mcpServers = useAppSelector((state) => state.mcp.servers);
  const mcpLoaded = useAppSelector((state) => state.mcp.loaded);
  const mcpToolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const listedModels = useAppSelector(selectCombinedModels);
  const selectedModel = useAppSelector(selectSelectedModelKey);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await seedStorageDefaults(getChatHost().storage, navigator.language);
      if (cancelled) return;
      await loadStoredLanguage();
      dispatch(initializeOllama());
      dispatch(initializeCustomModels());
      dispatch(initializeApp());
      dispatch(initializeQuickCommands());
      dispatch(initializeMcp());
    })();
    if (!ownsRuntime) {
      return () => {
        cancelled = true;
      };
    }
    return () => {
      cancelled = true;
      void (async () => {
        await closeMcpSessions();
        await onRuntimeStop?.();
      })();
    };
  }, [dispatch, ownsRuntime, onRuntimeStop]);

  // 快捷指令在设置里改完，已经打开的聊天页跟着更新。设置页和聊天页可能不在同一份文档里。
  useEffect(() => {
    return getChatHost().storage.subscribe((changes, area) => {
      if (area === 'sync' && changes.quickCommands) {
        dispatch(setQuickCommands(changes.quickCommands.newValue));
      }
    });
  }, [dispatch]);

  useEffect(() => {
    if (!ownsRuntime) return;
    return getChatHost().storage.subscribe((changes, area) => {
      const next = readMcpLocalChange(area, changes);
      if (!next) return;
      if (next.servers) dispatch(setMcpServers(next.servers));
      if (next.toolsEnabled !== undefined) dispatch(setMcpToolsEnabled(next.toolsEnabled));
    });
  }, [dispatch, ownsRuntime]);

  useEffect(() => {
    if (!ownsRuntime || !mcpLoaded) return;
    void syncMcpSessions(mcpServers).finally(() => refreshAgentTools());
  }, [ownsRuntime, mcpLoaded, mcpServers]);

  useEffect(() => {
    if (!ownsRuntime || !mcpLoaded) return;
    refreshAgentTools();
  }, [ownsRuntime, mcpLoaded, mcpToolsEnabled, listedModels, selectedModel]);

  if (!ollamaUrl) return null;

  return (
    <XProvider
      theme={{
        cssVar: { key: 'css-var-r1' },
        hashed: false,
        algorithm: isDarkMode ? darkAlgorithm : defaultAlgorithm,
      }}
    >
      <AntdApp message={{ top: 57 }}>
        <ChatLayoutProvider layout={getChatHost().layout ?? 'compact'}>
          <div className={`chat-shell chat-shell-${getChatHost().layout ?? 'compact'}`}>
            <SidePanelMain setAppMode={setMode} appMode={appMode} />
          </div>
        </ChatLayoutProvider>
      </AntdApp>
    </XProvider>
  );
};

const ChatRoot: React.FC<ChatRootProps> = (props) => (
  <Provider store={store}>
    <ThemedApp {...props} />
  </Provider>
);

export default ChatRoot;
