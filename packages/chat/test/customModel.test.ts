/// <reference lib="dom" />
import {
  cleanContextWindows,
  cleanModelNames,
  customModelId,
  customModelIdFromKey,
  customModelKey,
  draftToCustomService,
  effectiveProtocol,
  emptyCustomServiceDraft,
  expandCustomService,
  formatTokens,
  inferProtocol,
  isCustomModelKey,
  modelsListUrl,
  normalizeCustomService,
  normalizeStoredCustomServices,
  parseTokenCount,
  resolveContextWindow,
  validateCustomService,
} from '../src/models/customModel';
import { parseSseBlock } from '../src/utils/sseFetch';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function equal(actual: unknown, expected: unknown, message: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// 协议推断：按末尾路径，认不出就走 Chat Completions。
equal(
  inferProtocol('https://gateway.example.com/openapi/v1/chat/completions'),
  'chat_completions',
  'chat path'
);
equal(
  inferProtocol('https://gateway.example.com/openapi/v1/responses'),
  'responses',
  'responses path'
);
equal(
  inferProtocol('https://gateway.example.com/openapi/v1/messages/'),
  'messages',
  'messages path with slash'
);
equal(inferProtocol('https://example.com/v1/MESSAGES'), 'messages', 'case-insensitive');
equal(inferProtocol('https://example.com/custom'), 'chat_completions', 'unknown falls back');
equal(
  inferProtocol('https://example.com/chat?x=/responses'),
  'chat_completions',
  'query is ignored'
);

equal(
  effectiveProtocol({ url: 'https://a/v1/responses', customProtocol: false, protocol: 'messages' }),
  'responses',
  'explicit protocol is ignored while custom protocol is off'
);
equal(
  effectiveProtocol({ url: 'https://a/v1/responses', customProtocol: true, protocol: 'messages' }),
  'messages',
  'explicit protocol wins once enabled'
);

// 模型列表地址。
equal(
  modelsListUrl('https://gateway.example.com/openapi/v1/chat/completions'),
  'https://gateway.example.com/openapi/v1/models',
  'models url from chat completions'
);
equal(
  modelsListUrl('https://api.example.com/v1/responses?x=1#h'),
  'https://api.example.com/v1/models',
  'strip query'
);
equal(
  modelsListUrl('https://api.example.com/v1/messages/'),
  'https://api.example.com/v1/models',
  'messages'
);
equal(modelsListUrl('https://api.example.com/v1'), 'https://api.example.com/v1/models', 'base url');
equal(modelsListUrl('not a url'), null, 'invalid url');
equal(modelsListUrl('ftp://example.com/v1'), null, 'non-http url');

// 校验。
equal(validateCustomService({ url: 'nope', models: ['gpt-4o'] }), 'url', 'bad url');
equal(
  validateCustomService({ url: 'https://a.com/v1/chat/completions', models: ['  ', ''] }),
  'model',
  'blank models'
);
equal(
  validateCustomService({ url: 'https://a.com/v1/chat/completions', models: [] }),
  'model',
  'no models'
);
equal(
  validateCustomService({ url: 'http://127.0.0.1:8000/v1/chat/completions', models: ['x'] }),
  null,
  'ok'
);

// 模型名清洗：去空白、去重、保序。
equal(cleanModelNames([' a ', 'b', 'a', '', 3, null, 'b ']), ['a', 'b'], 'model names are cleaned');
equal(cleanModelNames('a'), [], 'non-array');

// 草稿落成服务。
{
  const service = draftToCustomService({
    ...emptyCustomServiceDraft(),
    url: ' https://a.com/v1/chat/completions ',
    apiKey: ' sk-1 ',
    models: [' gpt-4o ', 'gpt-4o-mini', 'gpt-4o'],
    customProtocol: false,
    sessionHeaders: true,
    contextWindows: [614400, 307200.7, 983040, 307200, -1, 0],
    maxOutputTokens: -5,
  });
  assert(service.id.length > 0, 'id is generated');
  equal(
    [service.url, service.apiKey, service.models],
    ['https://a.com/v1/chat/completions', 'sk-1', ['gpt-4o', 'gpt-4o-mini']],
    'trimmed and de-duplicated'
  );
  equal(
    service.sessionHeaders,
    false,
    'session headers are dropped while the protocol panel is closed'
  );
  equal(
    service.contextWindows,
    [307200, 614400, 983040],
    'context windows are floored, de-duplicated, sorted and stripped of invalid values'
  );
  equal(service.maxOutputTokens, undefined, 'non-positive token counts are dropped');
  equal(
    draftToCustomService({ ...service, customProtocol: true, sessionHeaders: true }).sessionHeaders,
    true,
    'kept when open'
  );

  // 一个服务展开成多个模型，共享地址、Key 和能力，id 彼此不同。
  const expanded = expandCustomService({ ...service, vision: true });
  equal(
    expanded.map((model) => [model.id, model.serviceId, model.model]),
    [
      [customModelId(service.id, 'gpt-4o'), service.id, 'gpt-4o'],
      [customModelId(service.id, 'gpt-4o-mini'), service.id, 'gpt-4o-mini'],
    ],
    'one model per name'
  );
  assert(
    expanded.every(
      (model) => model.url === service.url && model.apiKey === 'sk-1' && model.vision === true
    ),
    'models share the service settings'
  );
  assert(!('models' in expanded[0]), 'expanded models do not carry the name list');
}

// 存储里读出来的值不可信。
{
  const good = {
    id: 'a',
    url: 'https://a.com/v1/chat/completions',
    apiKey: 'k',
    models: ['m', 'n', 'm'],
    tools: false,
    vision: true,
    protocol: 'weird',
  };
  const services = normalizeStoredCustomServices([
    good,
    good,
    { ...good, id: 'b', url: 'javascript:alert(1)' },
    { ...good, id: 'c', models: [] },
    { ...good, id: 'd', models: undefined, model: 'legacy' },
    { url: 'https://a.com', models: ['m'] },
    null,
    'x',
  ]);
  equal(services.length, 1, 'invalid and duplicate entries are dropped');
  equal(services[0].models, ['m', 'n'], 'model names are cleaned');
  equal(services[0].protocol, 'chat_completions', 'unknown protocol falls back');
  equal(
    [services[0].tools, services[0].vision, services[0].thinking],
    [false, true, false],
    'flags are kept or defaulted'
  );
  equal(normalizeStoredCustomServices(undefined), [], 'missing storage');
  equal(normalizeStoredCustomServices({}), [], 'non-array storage');
}

// 键。
{
  const key = customModelKey('abc');
  assert(isCustomModelKey(key), 'custom key is recognised');
  assert(!isCustomModelKey('qwen2.5:7b'), 'ollama name is not a custom key');
  assert(!isCustomModelKey(undefined), 'undefined is not a custom key');
  equal(customModelIdFromKey(key), 'abc', 'id round trip');
  equal(
    customModelIdFromKey(customModelKey(customModelId('s1', 'openai/gpt-4o:latest'))),
    's1::openai/gpt-4o:latest',
    'model names with slashes and colons survive the key round trip'
  );
}

equal(formatTokens(1024 * 1024), '1024K', '1M is shown as 1024K like the docs');
equal(formatTokens(32 * 1024), '32K', '32K');
equal(formatTokens(1000), '1000', 'non-K value');
equal(formatTokens(undefined), '', 'empty');

// 上下文窗口：输入解析、旧数据迁移、选择回退。
equal(parseTokenCount('300K'), 307200, 'K is 1024');
equal(parseTokenCount(' 960k '), 983040, 'lower case and spaces');
equal(parseTokenCount('1M'), 1048576, 'M');
equal(parseTokenCount('1048576'), 1048576, 'plain number');
equal(parseTokenCount('0.5K'), 512, 'fraction');
equal(parseTokenCount('abc'), undefined, 'not a number');
equal(parseTokenCount('-3K'), undefined, 'negative');
equal(parseTokenCount(''), undefined, 'empty input');
equal(cleanContextWindows('x'), [], 'non-array context windows');
equal(emptyCustomServiceDraft().contextWindows, [], 'draft starts without context windows');
{
  const base = { id: 'a', url: 'https://a.com/v1/chat/completions', models: ['m'] };
  equal(
    normalizeCustomService({ ...base, contextTokens: 131072 })?.contextWindows,
    [131072],
    'legacy single context value becomes the only option'
  );
  equal(
    normalizeCustomService({ ...base, contextWindows: [2048, 1024], contextTokens: 1 })
      ?.contextWindows,
    [1024, 2048],
    'new field wins over the legacy one'
  );
  equal(normalizeCustomService(base)?.contextWindows, [], 'none configured');
}
equal(resolveContextWindow([300, 600, 960], 600), 600, 'chosen value is used');
equal(resolveContextWindow([300, 600, 960], 777), 960, 'unknown choice falls back to the largest');
equal(resolveContextWindow([300, 600, 960], undefined), 960, 'no choice uses the largest');
equal(resolveContextWindow([], 600), undefined, 'no options');

// SSE 块解析。
equal(parseSseBlock('event: a\ndata: {"x":1}'), { event: 'a', data: '{"x":1}' }, 'event + data');
equal(parseSseBlock('data:1\ndata: 2'), { event: '', data: '1\n2' }, 'multi-line data');
equal(parseSseBlock(': keep-alive'), null, 'comment only');
equal(parseSseBlock('event: ping'), null, 'no data');

if (failed) throw new Error(`${failed} assertion(s) failed`);
console.log('custom model fixtures passed');
