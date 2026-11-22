import type { KeyValueStorage, StorageArea, StorageChange } from '@ddrl/chat';

export const chromeStorage: KeyValueStorage = {
  async get(area, keys) {
    return chrome.storage[area].get(keys ?? null);
  },
  async set(area, items) {
    await chrome.storage[area].set(items);
  },
  subscribe(listener) {
    const wrapped = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' && areaName !== 'sync') return;
      const next: Record<string, StorageChange> = {};
      for (const [key, change] of Object.entries(changes)) {
        next[key] = { oldValue: change.oldValue, newValue: change.newValue };
      }
      listener(next, areaName as StorageArea);
    };
    chrome.storage.onChanged.addListener(wrapped);
    return () => chrome.storage.onChanged.removeListener(wrapped);
  },
};
