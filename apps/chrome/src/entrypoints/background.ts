import { defineBackground } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import { SELECTION_COMMANDS, SYNC_VALUE_CHANGED, DEFAULT_OLLAMA_URL } from '@/constants/command';
import { DEFAULT_LINKS, DEFAULT_PROMPTS } from '@/constants/default';

export type StorageChangeMessage = {
  type: string;
  key: string;
  payload: any;
};

export default defineBackground(() => {
  // 监听 icon 点击事件，展开侧边栏
  chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
  });

  // 创建根菜单
  const rootMenu = browser.contextMenus.create({
    id: 'ddrl',
    title: browser.i18n.getMessage('openDDRL'),
    contexts: ['page', 'selection'],
  });
  // 选中片段
  browser.contextMenus.create({
    id: SELECTION_COMMANDS.TRANSLATE_SELECTED,
    title: browser.i18n.getMessage('translateSelected'),
    parentId: rootMenu,
    contexts: ['selection'],
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id || !tab.windowId) return;

    await chrome.sidePanel.open({ windowId: tab.windowId });

    // 等待一小段时间确保 sidepanel 已打开
    await new Promise((resolve) => setTimeout(resolve, 600));

    switch (info.menuItemId) {
      case SELECTION_COMMANDS.TRANSLATE_SELECTED:
        if (info.selectionText) {
          await chrome.runtime.sendMessage({
            type: SELECTION_COMMANDS.TRANSLATE_SELECTED,
            text: info.selectionText,
          });
        }
        break;

      case SELECTION_COMMANDS.RECORD_SELECTED:
        await chrome.runtime.sendMessage({
          type: SELECTION_COMMANDS.RECORD_SELECTED,
        });
        break;

      case SELECTION_COMMANDS.TRANSLATE_PAGE:
        await chrome.runtime.sendMessage({
          type: SELECTION_COMMANDS.TRANSLATE_PAGE,
        });
        break;

      case SELECTION_COMMANDS.RECORD_PAGE:
        await chrome.runtime.sendMessage({
          type: SELECTION_COMMANDS.RECORD_PAGE,
        });
        break;
    }
  });

  // 判断 local 和 sync 是否有值后再做初始化
  chrome.storage.local.get().then((localObj) => {
    const { historyConversations } = localObj;
    if (!historyConversations) {
      chrome.storage.local.set({
        // 历史会话列表
        historyConversations: [],
      });
    }
  });

  chrome.storage.sync.get().then((syncObj) => {
    const { appSettings } = syncObj;

    if (!appSettings) {
      chrome.storage.sync.set({
        // 系统配置
        appSettings: {
          isDarkMode: false,
          lang: navigator.language,
        },

        // 当前会话的模型配置
        ollamaModelParams: {},

        // ollama配置
        ollamaSettings: {
          url: DEFAULT_OLLAMA_URL,
        },

        // 自定义提示词
        customPrompts: DEFAULT_PROMPTS,

        // 自定义链接
        customLinks: navigator.language === 'zh-CN' ? DEFAULT_LINKS : [],
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    // 检查是否是 `sync` 存储区域的变化
    if (areaName === 'sync') {
      // 遍历所有变化的键
      for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
        console.log(`${key} in sync changed`, oldValue, newValue);

        // 派发事件
        chrome.runtime.sendMessage({
          type: SYNC_VALUE_CHANGED,
          key,
          payload: newValue,
        } as StorageChangeMessage);
      }
    }
  });
});
