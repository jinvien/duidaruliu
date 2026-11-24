import { LEGACY_SEED_PROMPTS } from '../constants/default';

/** 一条快捷指令：标题用来显示，正文是真正发给模型的内容。 */
export type QuickCommand = { id: string; title: string; content: string };

export type QuickCommandCategory = { id: string; name: string; commands: QuickCommand[] };

/** 默认分类。引用页面后，这个分类下的指令会显示成页面卡片上的快捷按钮。 */
export const ARTICLE_CATEGORY_ID = 'article';
/** 旧版自定义提示词迁移后落到的分类。 */
export const MIGRATED_CATEGORY_ID = 'custom';

export function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isZh(language: string): boolean {
  return language.toLowerCase().startsWith('zh');
}

function articleCategory(language: string): QuickCommandCategory {
  const zh = isZh(language);
  return {
    id: ARTICLE_CATEGORY_ID,
    name: zh ? '文章快捷指令' : 'Article commands',
    commands: [
      {
        id: 'article-summary',
        title: zh ? '总结全文' : 'Summarize',
        content: zh
          ? '请总结这篇文章的全文，保留关键信息。'
          : 'Please summarize the full text of this article and keep the key information.',
      },
      {
        id: 'article-points',
        title: zh ? '提取要点' : 'Key points',
        content: zh
          ? '请提取这篇文章的要点，用条目列出。'
          : 'Please extract the key points of this article as a list.',
      },
      {
        id: 'article-translate',
        title: zh ? '翻译全文' : 'Translate',
        content: zh
          ? '请把这篇文章的正文完整翻译成中文。'
          : 'Please translate the full text of this article into English.',
      },
      {
        id: 'article-save',
        title: zh ? '录入知识库' : 'Save to knowledge base',
        content: zh
          ? '请把这篇文章整理成一条可以录入知识库的笔记，包含：标题、一句话摘要、核心要点、关键词标签、原文链接。如果当前有可用的知识库工具，请直接调用它录入；没有的话，就直接输出整理好的内容。'
          : 'Please turn this article into a note that can be saved to a knowledge base, including: title, one-line summary, key points, keyword tags, and the source link. If a knowledge base tool is available, call it to save the note; otherwise just output the finished note.',
      },
    ],
  };
}

export function buildDefaultQuickCommands(language: string): QuickCommandCategory[] {
  return [articleCategory(language)];
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeCommands(raw: unknown): QuickCommand[] {
  if (!Array.isArray(raw)) return [];
  const commands: QuickCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const title = asText((item as any).title);
    const content = asText((item as any).content);
    if (title === null || content === null) continue;
    commands.push({ id: asText((item as any).id) || newId(), title, content });
  }
  return commands;
}

/**
 * 把读出来的存储值整理成可用的分类列表。
 * 读不出来时给默认值；默认分类被删掉或丢失时补回来，页面卡片上的快捷按钮靠它。
 */
export function normalizeQuickCommands(raw: unknown, language: string): QuickCommandCategory[] {
  if (!Array.isArray(raw)) return buildDefaultQuickCommands(language);
  const categories: QuickCommandCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = asText((item as any).name);
    if (name === null) continue;
    let id = asText((item as any).id) || newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    categories.push({ id, name, commands: normalizeCommands((item as any).commands) });
  }
  if (!categories.some((category) => category.id === ARTICLE_CATEGORY_ID)) {
    categories.unshift(articleCategory(language));
  }
  return categories;
}

/**
 * 旧版 customPrompts（扁平的 label / value / type 列表）迁移成分类结构。
 * 没改过的旧预置项直接丢掉，其余原样放进「自定义指令」分类；旧的 system / quick 区别不再保留。
 */
export function migrateLegacyPrompts(raw: unknown, language: string): QuickCommandCategory[] {
  const categories = buildDefaultQuickCommands(language);
  if (!Array.isArray(raw)) return categories;
  const commands: QuickCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const title = asText((item as any).label);
    const content = asText((item as any).value);
    if (title === null || content === null) continue;
    const untouchedSeed = LEGACY_SEED_PROMPTS.some(
      (seed) => seed.label === title && seed.value === content
    );
    if (untouchedSeed) continue;
    commands.push({ id: newId(), title, content });
  }
  if (commands.length) {
    categories.push({
      id: MIGRATED_CATEGORY_ID,
      name: isZh(language) ? '自定义指令' : 'Custom commands',
      commands,
    });
  }
  return categories;
}

/** 默认分类下的指令，用作引用页面后的快捷按钮。 */
export function articleCommands(categories: QuickCommandCategory[]): QuickCommand[] {
  return categories.find((category) => category.id === ARTICLE_CATEGORY_ID)?.commands ?? [];
}

export function findQuickCommand(
  categories: QuickCommandCategory[],
  commandId: string
): QuickCommand | undefined {
  for (const category of categories) {
    const hit = category.commands.find((command) => command.id === commandId);
    if (hit) return hit;
  }
  return undefined;
}

export type QuickCommandOption = {
  label: string;
  value: string;
  children?: QuickCommandOption[];
};

/** 给 / 弹出的级联菜单用：分类是第一层，指令是第二层。空分类不显示，不然它会被当成可选的叶子。 */
export function toSuggestionOptions(categories: QuickCommandCategory[]): QuickCommandOption[] {
  return categories
    .filter((category) => category.commands.length > 0)
    .map((category) => ({
      label: category.name,
      value: `category:${category.id}`,
      children: category.commands.map((command) => ({
        label: command.title,
        value: command.id,
      })),
    }));
}
