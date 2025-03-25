/**
 * @file 获取当前 tab 信息
 */

export const queryCurrentTab = async () => {
  const tabs = (await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })) as chrome.tabs.Tab[];
  return tabs[0];
};
