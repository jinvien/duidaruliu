const browserWindow = globalThis.window ?? {
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
};
if (!globalThis.window) {
  Object.defineProperty(globalThis, 'window', { value: browserWindow, configurable: true });
}

import type { Message } from '../src/store/chatSlice';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

async function main() {
  const { createMemoryStorage, installChatHost } = await import('../src/host');
  const { seedStorageDefaults } = await import('../src/storage/seed');
  const { initializeConversations, storeCurrentMessagesFunc } = await import(
    '../src/store/historySlice'
  );
  const { default: store } = await import('../src/store');
  const storage = createMemoryStorage();
  const seen: string[] = [];
  storage.subscribe((changes, area) => {
    seen.push(`${area}:${Object.keys(changes).join(',')}`);
  });
  installChatHost({ storage, openSettings() {} });

  await seedStorageDefaults(storage, 'zh-CN');
  const seeded = await storage.get('sync', 'appSettings');
  assert(seeded.appSettings?.lang === 'zh-CN', 'seed writes the language');
  assert((await storage.get('sync', 'ollamaSettings')).ollamaSettings?.url, 'seed writes ollama url');
  await seedStorageDefaults(storage, 'en');
  assert(
    (await storage.get('sync', 'appSettings')).appSettings?.lang === 'zh-CN',
    'seed does not overwrite an existing settings record',
  );

  const messages: Message[] = [{ role: 'user', content: '记住这句', createdAt: 10 }];
  const saved = await storeCurrentMessagesFunc(messages);
  assert(saved?.length === 1, 'history write returns the stored list');
  assert(seen.some((item) => item.startsWith('local:historyConversations')), 'history write notifies subscribers');

  await store.dispatch(initializeConversations());
  assert(
    store.getState().history.conversations[0]?.messages[0]?.content === '记住这句',
    'history read comes back from the same storage',
  );

  if (failed) {
    console.error(`${failed} storage host assertions failed`);
    process.exit(1);
  }
  console.log('storage host fixtures passed');
}

void main();
