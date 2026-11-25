import { DEFAULT_LINKS } from '../constants/default';
import { DEFAULT_OLLAMA_URL } from '../constants/command';
import { buildDefaultQuickCommands, migrateLegacyPrompts } from '../utils/quickCommand';

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
      quickCommands: buildDefaultQuickCommands(language),
      customLinks: language === 'zh-CN' ? DEFAULT_LINKS : [],
    });
  } else if (!sync.quickCommands) {
    // 老用户：把旧的自定义提示词迁到快捷指令里。旧的 customPrompts 保留不动。
    await bucket.set('sync', {
      quickCommands: migrateLegacyPrompts(sync.customPrompts, language),
    });
  }
}
