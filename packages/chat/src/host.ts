import type { PageSnapshot } from './page/types';

export type StorageArea = 'local' | 'sync';

/** 与 chrome.storage 一样，值是本应用自己写入的 JSON。 */
export type StorageItems = { [key: string]: any };

export type StorageChange = { newValue?: unknown; oldValue?: unknown };

export type KeyValueStorage = {
  get(area: StorageArea, keys?: string | string[] | null): Promise<StorageItems>;
  set(area: StorageArea, items: StorageItems): Promise<void>;
  subscribe(
    listener: (changes: Record<string, StorageChange>, area: StorageArea) => void,
  ): () => void;
};

export type HostCommand = { type: string; text?: string };

export type PageRequest = { tabId: number };

export type McpRuntimeListener = (runtime: unknown[]) => void;

export type ChatLayout = 'compact' | 'desktop';

export type ChatHost = {
  storage: KeyValueStorage;
  /** 不写时按紧凑侧栏排。Web 日常使用传 desktop，Chrome 不要传。 */
  layout?: ChatLayout;
  openSettings: () => void;
  /** 扩展右键菜单等宿主命令。Web 预览不接。 */
  subscribeHostCommand?: (listener: (command: HostCommand) => void) => () => void;
  /** 采集页面快照。不传 tabId 时取当前窗口的活动标签页。Web 预览不实现。 */
  capturePage?: (tabId?: number) => Promise<PageSnapshot>;
  /** 右键菜单等入口请求引用某个页面。 */
  subscribePageRequest?: (listener: (request: PageRequest) => void) => () => void;
  /** 设置页和聊天页不在同一份文档时，用它看 MCP 连接状态。 */
  watchMcpRuntime?: (listener: (runtime: unknown[]) => void) => () => void;
};

let host: ChatHost | undefined;
let serviceFetchImpl: typeof fetch | undefined;

export function installChatHost(next: ChatHost) {
  host = next;
}

export function getChatHost(): ChatHost {
  if (!host) throw new Error('Chat host is not installed');
  return host;
}

export function storageGet(area: StorageArea, keys?: string | string[] | null) {
  return getChatHost().storage.get(area, keys);
}

export function storageSet(area: StorageArea, items: StorageItems) {
  return getChatHost().storage.set(area, items);
}

/** 调用时再取 fetch，测试可以在导入之后替换 globalThis.fetch。 */
export function getServiceFetch(): typeof fetch {
  return serviceFetchImpl ?? globalThis.fetch.bind(globalThis);
}

export function setServiceFetch(next: typeof fetch) {
  serviceFetchImpl = next;
}

export function createMemoryStorage(initial?: {
  local?: StorageItems;
  sync?: StorageItems;
}): KeyValueStorage {
  const areas: Record<StorageArea, StorageItems> = {
    local: { ...(initial?.local ?? {}) },
    sync: { ...(initial?.sync ?? {}) },
  };
  const listeners = new Set<
    (changes: Record<string, StorageChange>, area: StorageArea) => void
  >();
  return {
    async get(area, keys) {
      const source = areas[area];
      if (keys == null) return { ...source };
      const list = typeof keys === 'string' ? [keys] : keys;
      const result: StorageItems = {};
      for (const key of list) result[key] = source[key];
      return result;
    },
    async set(area, items) {
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: areas[area][key], newValue: value };
        areas[area][key] = value;
      }
      for (const listener of listeners) listener(changes, area);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
