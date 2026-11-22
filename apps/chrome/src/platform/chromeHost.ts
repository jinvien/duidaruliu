import {
  MCP_RUNTIME_PUSH,
  MCP_RUNTIME_QUERY,
  getMcpRuntime,
  subscribeMcpRuntime,
  store,
  type ChatHost,
} from '@ddrl/chat';

import { clearMcpOriginRules, rewriteOrigin, syncMcpOriginRules } from '@/utils/rewriteOrigin';
import { queryCurrentTab } from '@/utils/tab';

import { chromeStorage } from './chromeStorage';

export function openChromeSettings() {
  void (async () => {
    const currentTabUrl = (await queryCurrentTab()).url || '';
    const isOptionsPage = /^chrome-extension:\/\/ghfkjnjclg.*\/sidepanel\.html.*$/.test(
      currentTabUrl,
    );
    if (isOptionsPage) return;
    await chrome.tabs.create({
      url: chrome.runtime.getURL('sidepanel.html?appMode=setting'),
    });
  })();
}

export function subscribeChromeCommands(
  listener: (command: { type: string; text?: string }) => void,
) {
  const wrapped = (message: { type?: string; text?: string }) => {
    if (!message?.type) return;
    void listener({ type: message.type, text: message.text });
  };
  chrome.runtime.onMessage.addListener(wrapped);
  return () => chrome.runtime.onMessage.removeListener(wrapped);
}

/** 设置页是另一个文档，向持有连接的侧栏要运行状态。 */
export function watchChromeMcpRuntime(listener: (runtime: unknown[]) => void) {
  const onMessage = (message: { type?: string; runtime?: unknown[] }) => {
    if (message?.type === MCP_RUNTIME_PUSH && Array.isArray(message.runtime)) {
      listener(message.runtime);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  void Promise.resolve(chrome.runtime.sendMessage({ type: MCP_RUNTIME_QUERY }))
    .then((response: { runtime?: unknown[] } | undefined) => {
      if (Array.isArray(response?.runtime)) listener(response.runtime);
    })
    .catch(() => undefined);
  return () => chrome.runtime.onMessage.removeListener(onMessage);
}

export function createChromeHost(ownsRuntime: boolean): ChatHost {
  return {
    storage: chromeStorage,
    openSettings: openChromeSettings,
    subscribeHostCommand: ownsRuntime ? subscribeChromeCommands : undefined,
    watchMcpRuntime: ownsRuntime ? undefined : watchChromeMcpRuntime,
  };
}

/** 聊天侧栏持有连接时，把运行状态回给设置页。 */
export function startChromeMcpBridge() {
  const push = () => {
    const message = { type: MCP_RUNTIME_PUSH, runtime: getMcpRuntime() };
    try {
      void Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => undefined);
    } catch {
      // 设置页没打开时没有接收方。
    }
  };
  const unsubscribe = subscribeMcpRuntime(push);
  const onMessage = (
    message: { type?: string },
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message?.type !== MCP_RUNTIME_QUERY) return;
    sendResponse({ runtime: getMcpRuntime() });
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => {
    unsubscribe();
    chrome.runtime.onMessage.removeListener(onMessage);
  };
}

/** Ollama 的 Origin 规则两边文档都写。MCP 规则只由持有连接的侧栏写。 */
export function bindChromeOriginRules(ownsRuntime: boolean) {
  let lastOllama = '';
  let lastServers = '';
  const apply = () => {
    const state = store.getState();
    if (state.ollama.ollamaUrl && state.ollama.ollamaUrl !== lastOllama) {
      lastOllama = state.ollama.ollamaUrl;
      void rewriteOrigin(lastOllama);
    }
    if (!ownsRuntime || !state.mcp.loaded) return;
    const key = JSON.stringify(state.mcp.servers);
    if (key === lastServers) return;
    lastServers = key;
    void syncMcpOriginRules(state.mcp.servers);
  };
  apply();
  return store.subscribe(apply);
}

export { clearMcpOriginRules };
