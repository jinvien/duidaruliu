import { DEFAULT_LINKS, DEFAULT_PROMPTS } from '../constants/default';
import { DEFAULT_OLLAMA_URL } from '../constants/command';

import type { KeyValueStorage } from '../host';

/** 缺省时写入和扩展背景页相同的初始值。已有 appSettings 时不覆盖。 */
export async function seedStorageDefaults(bucket: KeyValueStorage, language: string) {
  const local = await bucket.get('local');
  if (!local.historyConversations) {
    await bucket.set('local', { historyConversations: [] });
  }
  const sync = await bucket.get('sync');
  if (!sync.appSettings) {
    await bucket.set('sync', {
      appSettings: {
        isDarkMode: false,
        lang: language,
      },
      ollamaModelParams: {},
      ollamaSettings: {
        url: DEFAULT_OLLAMA_URL,
      },
      customPrompts: DEFAULT_PROMPTS,
      customLinks: language === 'zh-CN' ? DEFAULT_LINKS : [],
    });
  }
}
