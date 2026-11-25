let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

async function main() {
  const { createMemoryStorage } = await import('../src/host');
  const { seedStorageDefaults } = await import('../src/storage/seed');
  const { LEGACY_SEED_PROMPTS } = await import('../src/constants/default');
  const {
    ARTICLE_CATEGORY_ID,
    MIGRATED_CATEGORY_ID,
    articleCommands,
    buildDefaultQuickCommands,
    findQuickCommand,
    migrateLegacyPrompts,
    normalizeQuickCommands,
    toSuggestionOptions,
  } = await import('../src/utils/quickCommand');

  // 默认分类和四条指令
  const zh = buildDefaultQuickCommands('zh-CN');
  assert(zh.length === 1 && zh[0].id === ARTICLE_CATEGORY_ID, 'default has the article category only');
  assert(zh[0].name === '文章快捷指令', 'default category name in Chinese');
  assert(
    articleCommands(zh).map((item) => item.title).join(',') === '总结全文,提取要点,翻译全文,录入知识库',
    'default article commands',
  );
  assert(
    articleCommands(zh).every((item) => item.content.trim().length > 0),
    'every default command has a body',
  );
  assert(buildDefaultQuickCommands('en-US')[0].name === 'Article commands', 'default category name in English');

  // 读取时的整理
  assert(normalizeQuickCommands(undefined, 'zh-CN')[0].id === ARTICLE_CATEGORY_ID, 'missing value falls back to defaults');
  assert(normalizeQuickCommands('oops', 'zh-CN').length === 1, 'invalid value falls back to defaults');
  const restored = normalizeQuickCommands(
    [{ id: 'mine', name: '我的', commands: [{ id: 'a', title: 't', content: 'c' }, { title: 1 }, null] }],
    'zh-CN',
  );
  assert(restored[0].id === ARTICLE_CATEGORY_ID && restored[1].id === 'mine', 'a lost article category is put back first');
  assert(restored[1].commands.length === 1, 'malformed commands are dropped');
  const noIds = normalizeQuickCommands(
    [{ name: 'x', commands: [{ title: 't', content: 'c' }] }],
    'zh-CN',
  );
  assert(Boolean(noIds[1].id) && Boolean(noIds[1].commands[0].id), 'missing ids are filled in');
  const dup = normalizeQuickCommands(
    [{ id: ARTICLE_CATEGORY_ID, name: 'a', commands: [] }, { id: ARTICLE_CATEGORY_ID, name: 'b', commands: [] }],
    'zh-CN',
  );
  assert(dup[0].id !== dup[1].id, 'duplicate category ids are made unique');

  // 旧数据迁移
  const untouched = LEGACY_SEED_PROMPTS.slice(0, 2).map((item) => ({ ...item, type: 'quick' }));
  assert(
    migrateLegacyPrompts(untouched, 'zh-CN').length === 1,
    'untouched legacy seeds are dropped',
  );
  const migrated = migrateLegacyPrompts(
    [
      ...untouched,
      { label: '解梦专家', value: '我改过的内容', type: 'quick' },
      { label: '润色', value: '请润色', type: 'system' },
    ],
    'zh-CN',
  );
  const custom = migrated.find((item) => item.id === MIGRATED_CATEGORY_ID);
  assert(custom?.commands.map((item) => item.title).join(',') === '解梦专家,润色', 'edited and user prompts are kept');
  assert(custom?.commands[1].content === '请润色', 'migrated body is the old value');
  assert(migrateLegacyPrompts(undefined, 'zh-CN').length === 1, 'no legacy data gives defaults');

  // / 菜单和查找
  const options = toSuggestionOptions([
    ...zh,
    { id: 'empty', name: '空', commands: [] },
  ]);
  assert(options.length === 1 && options[0].children?.length === 4, 'empty categories are hidden from the menu');
  const summary = findQuickCommand(zh, 'article-summary');
  assert(summary?.title === '总结全文', 'command lookup by id');
  assert(findQuickCommand(zh, 'category:article') === undefined, 'category values are not commands');

  // 存储种子
  const fresh = createMemoryStorage();
  await seedStorageDefaults(fresh, 'zh-CN');
  const freshSync = await fresh.get('sync');
  assert(freshSync.quickCommands?.[0]?.id === ARTICLE_CATEGORY_ID, 'fresh install seeds quick commands');
  assert(freshSync.customPrompts === undefined, 'fresh install no longer seeds legacy prompts');

  const old = createMemoryStorage({
    sync: {
      appSettings: { isDarkMode: false, lang: 'zh-CN' },
      customPrompts: [...untouched, { label: '润色', value: '请润色', type: 'quick' }],
    },
  });
  await seedStorageDefaults(old, 'zh-CN');
  const oldSync = await old.get('sync');
  assert(oldSync.quickCommands?.length === 2, 'existing install is migrated once');
  assert(oldSync.customPrompts?.length === 3, 'legacy data is left in place');
  const before = JSON.stringify(oldSync.quickCommands);
  await seedStorageDefaults(old, 'zh-CN');
  assert(JSON.stringify((await old.get('sync')).quickCommands) === before, 'migration does not run again');

  if (failed) {
    console.error(`${failed} quick command assertions failed`);
    process.exit(1);
  }
  console.log('quick command fixtures passed');
}

void main();
