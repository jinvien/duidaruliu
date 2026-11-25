import { defineBackground } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import { SELECTION_COMMANDS, SYNC_VALUE_CHANGED } from '@ddrl/chat/constants';
import { seedStorageDefaults } from '@ddrl/chat/storage';

import { chromeStorage } from '@/platform/chromeStorage';
import { postPageRequest } from '@/platform/pageRequest';

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

  // 整页发送：提取在侧边栏里做，这里只通知“哪个标签页”。
  browser.contextMenus.create({
    id: SELECTION_COMMANDS.SEND_PAGE,
    title: browser.i18n.getMessage('sendToDDRL'),
    parentId: rootMenu,
    contexts: ['page', 'selection'],
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id || !tab.windowId) return;

    if (info.menuItemId === SELECTION_COMMANDS.SEND_PAGE) {
      // sidePanel.open 要在用户手势里最先调用，前面不能有 await。
      const opening = chrome.sidePanel.open({ windowId: tab.windowId });
      await postPageRequest(tab.id);
      await opening;
      return;
    }

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

  void seedStorageDefaults(chromeStorage, navigator.language);

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
