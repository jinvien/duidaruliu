import 'fake-indexeddb/auto';

import { createIndexedDbStorage } from '../src/preview/idbStorage';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

async function main() {
  const storage = createIndexedDbStorage();
  const events: string[] = [];
  const stop = storage.subscribe((changes, area) => {
    events.push(`${area}:${Object.keys(changes).sort().join(',')}`);
  });

  await storage.set('local', { historyConversations: [{ messages: [{ content: '甲' }] }] });
  await storage.set('sync', { appSettings: { lang: 'zh-CN' }, ollamaSettings: { url: 'http://127.0.0.1:11434' } });

  const again = createIndexedDbStorage();
  const history = await again.get('local', 'historyConversations');
  const settings = await again.get('sync');
  assert(history.historyConversations?.[0]?.messages?.[0]?.content === '甲', 'local history survives a new handle');
  assert(settings.appSettings?.lang === 'zh-CN', 'sync settings survive');
  assert(settings.ollamaSettings?.url === 'http://127.0.0.1:11434', 'ollama url survives');
  assert(!('historyConversations' in settings), 'local keys stay out of sync reads');
  assert(events.includes('local:historyConversations'), 'set notifies subscribers');
  assert(events.includes('sync:appSettings,ollamaSettings'), 'one set notifies every changed key');

  stop();
  if (failed) {
    console.error(`${failed} indexeddb storage assertions failed`);
    process.exit(1);
  }
  console.log('indexeddb storage fixtures passed (fake-indexeddb, not a browser profile)');
  process.exit(0);
}

void main();
