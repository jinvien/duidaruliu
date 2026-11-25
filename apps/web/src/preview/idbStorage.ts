import type { KeyValueStorage, StorageArea, StorageChange, StorageItems } from '@ddrl/chat';

const DB_NAME = 'ddrl';
const DB_STORE = 'kv';
const CHANNEL = 'ddrl-storage';

function recordKey(area: StorageArea, key: string) {
  return `${area}:${key}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readOne(db: IDBDatabase, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const request = tx.objectStore(DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function writeOne(db: IDBDatabase, id: string, value: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const objectStore = tx.objectStore(DB_STORE);
    const read = objectStore.get(id);
    read.onerror = () => reject(read.error);
    read.onsuccess = () => {
      const oldValue = read.result;
      const put = objectStore.put(value, id);
      put.onerror = () => reject(put.error);
      tx.oncomplete = () => resolve(oldValue);
      tx.onerror = () => reject(tx.error);
    };
  });
}

function readArea(db: IDBDatabase, area: StorageArea): Promise<StorageItems> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const cursor = tx.objectStore(DB_STORE).openCursor();
    const result: StorageItems = {};
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve(result);
        return;
      }
      const id = String(current.key);
      if (id.startsWith(`${area}:`)) result[id.slice(area.length + 1)] = current.value;
      current.continue();
    };
  });
}

export function createIndexedDbStorage(): KeyValueStorage {
  const listeners = new Set<
    (changes: Record<string, StorageChange>, area: StorageArea) => void
  >();
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL);
  channel?.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { area?: StorageArea; changes?: Record<string, StorageChange> };
    if ((data?.area !== 'local' && data?.area !== 'sync') || !data.changes) return;
    for (const listener of listeners) listener(data.changes, data.area);
  });

  const notify = (area: StorageArea, changes: Record<string, StorageChange>) => {
    for (const listener of listeners) listener(changes, area);
    channel?.postMessage({ area, changes });
  };

  return {
    async get(area, keys) {
      const db = await openDb();
      if (keys == null) return readArea(db, area);
      const list = typeof keys === 'string' ? [keys] : keys;
      const result: StorageItems = {};
      for (const key of list) {
        result[key] = await readOne(db, recordKey(area, key));
      }
      return result;
    },
    async set(area, items) {
      const db = await openDb();
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        const oldValue = await writeOne(db, recordKey(area, key), value);
        changes[key] = { oldValue, newValue: value };
      }
      notify(area, changes);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
