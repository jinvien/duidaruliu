/**
 * 自定义模型：直连 OpenAI 兼容 / Responses / Claude Messages 协议的云端或自建服务。
 * 与 Ollama 并存，只在被选中时才走这里的请求链路。
 *
 * 配置的单位是「服务」：地址、Key、协议、能力只填一次，下面可以挂多个模型名。
 * 选择与请求的单位是展开后的 CustomModel（一个服务下的一个模型）。
 */

export type CustomProtocol = 'chat_completions' | 'responses' | 'messages';

export const CUSTOM_PROTOCOLS: readonly CustomProtocol[] = [
  'chat_completions',
  'responses',
  'messages',
];

export type CustomService = {
  id: string;
  /** 完整的请求地址，例如 https://api.example.com/v1/chat/completions。 */
  url: string;
  /** 为空时不发送鉴权头，适合本地无鉴权的网关。 */
  apiKey: string;
  /** 该服务下的模型名，对应请求体里的 model 字段。至少一个，彼此不重复。 */
  models: string[];
  /** 支持工具调用，允许把 MCP 工具带进请求。 */
  tools: boolean;
  /** 支持图片输入。 */
  vision: boolean;
  /** 请求里显式带上思考参数，并回填历史思考内容。 */
  thinking: boolean;
  /** 关闭时按 URL 末尾路径推断协议。 */
  customProtocol: boolean;
  /** 只有 customProtocol 打开时才生效。 */
  protocol: CustomProtocol;
  /** 附带会话与提问标识请求头和 prompt_cache_key，用于会话亲和与缓存命中。 */
  sessionHeaders: boolean;
  /** 上下文长度（token）。目前只作为信息记录，不参与请求。 */
  contextTokens?: number;
  /** 单次输出上限（token），对应各协议的 max tokens 字段。 */
  maxOutputTokens?: number;
};

export type CustomServiceDraft = Omit<CustomService, 'id'> & { id?: string };

/** 服务下的某一个模型，聊天、选择和请求都以它为单位。 */
export type CustomModel = Omit<CustomService, 'models'> & {
  /** `${serviceId}::${model}`，在所有服务里唯一。 */
  id: string;
  serviceId: string;
  model: string;
};

export const CUSTOM_MODEL_KEY_PREFIX = 'custom:';
const MODEL_ID_SEPARATOR = '::';

/** 1K 按 1024 计。 */
export const TOKEN_K = 1024;

export function customModelId(serviceId: string, model: string): string {
  return `${serviceId}${MODEL_ID_SEPARATOR}${model}`;
}

export function customModelKey(id: string): string {
  return `${CUSTOM_MODEL_KEY_PREFIX}${id}`;
}

export function isCustomModelKey(key: string | undefined): key is string {
  return typeof key === 'string' && key.startsWith(CUSTOM_MODEL_KEY_PREFIX);
}

export function customModelIdFromKey(key: string): string {
  return key.slice(CUSTOM_MODEL_KEY_PREFIX.length);
}

export function newCustomServiceId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyCustomServiceDraft(): CustomServiceDraft {
  return {
    url: '',
    apiKey: '',
    models: [],
    tools: true,
    vision: false,
    thinking: false,
    customProtocol: false,
    protocol: 'chat_completions',
    sessionHeaders: false,
  };
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function isValidModelUrl(value: string): boolean {
  return parseUrl(value) !== null;
}

/** 按路径末段推断协议。认不出来的一律按最通用的 Chat Completions 处理。 */
export function inferProtocol(url: string): CustomProtocol {
  const parsed = parseUrl(url);
  const path = (parsed?.pathname ?? url).replace(/\/+$/, '').toLowerCase();
  if (path.endsWith('/responses')) return 'responses';
  if (path.endsWith('/messages')) return 'messages';
  return 'chat_completions';
}

export function effectiveProtocol(
  model: Pick<CustomService, 'url' | 'customProtocol' | 'protocol'>
): CustomProtocol {
  return model.customProtocol ? model.protocol : inferProtocol(model.url);
}

const ENDPOINT_SUFFIX = /\/(chat\/completions|responses|messages)\/?$/i;

/** 由请求地址推出 /models 列表地址。地址不合法时返回 null。 */
export function modelsListUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = ENDPOINT_SUFFIX.test(path)
    ? path.replace(ENDPOINT_SUFFIX, '/models')
    : `${path}/models`;
  return parsed.toString();
}

/** 去空白、去重，保持输入顺序。 */
export function cleanModelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export type CustomServiceIssue = 'url' | 'model';

export function validateCustomService(
  draft: Pick<CustomServiceDraft, 'url' | 'models'>
): CustomServiceIssue | null {
  if (!isValidModelUrl(draft.url)) return 'url';
  if (cleanModelNames(draft.models).length === 0) return 'model';
  return null;
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 存储里读出来的值不可信。丢掉不合法的条目，补齐缺省字段。 */
export function normalizeCustomService(raw: unknown): CustomService | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (typeof value.url !== 'string') return null;
  const models = cleanModelNames(value.models);
  if (validateCustomService({ url: value.url, models })) return null;
  const protocol = CUSTOM_PROTOCOLS.includes(value.protocol as CustomProtocol)
    ? (value.protocol as CustomProtocol)
    : 'chat_completions';
  return {
    id: value.id,
    url: value.url.trim(),
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    models,
    tools: flag(value.tools, true),
    vision: flag(value.vision, false),
    thinking: flag(value.thinking, false),
    customProtocol: flag(value.customProtocol, false),
    protocol,
    sessionHeaders: flag(value.sessionHeaders, false),
    contextTokens: positiveInt(value.contextTokens),
    maxOutputTokens: positiveInt(value.maxOutputTokens),
  };
}

export function normalizeStoredCustomServices(raw: unknown): CustomService[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const services: CustomService[] = [];
  for (const item of raw) {
    const service = normalizeCustomService(item);
    if (!service || seen.has(service.id)) continue;
    seen.add(service.id);
    services.push(service);
  }
  return services;
}

/** 表单草稿落成可保存的服务。调用前应先通过 validateCustomService。 */
export function draftToCustomService(draft: CustomServiceDraft): CustomService {
  return {
    id: draft.id || newCustomServiceId(),
    url: draft.url.trim(),
    apiKey: draft.apiKey.trim(),
    models: cleanModelNames(draft.models),
    tools: draft.tools,
    vision: draft.vision,
    thinking: draft.thinking,
    customProtocol: draft.customProtocol,
    protocol: draft.protocol,
    // 会话头只在自定义协议面板里配置，关掉面板时一并关掉，避免看不见的行为。
    sessionHeaders: draft.customProtocol ? draft.sessionHeaders : false,
    contextTokens: positiveInt(draft.contextTokens),
    maxOutputTokens: positiveInt(draft.maxOutputTokens),
  };
}

/** 一个服务展开成它名下的所有模型。 */
export function expandCustomService(service: CustomService): CustomModel[] {
  const { models, ...shared } = service;
  return models.map((model) => ({
    ...shared,
    id: customModelId(service.id, model),
    serviceId: service.id,
    model,
  }));
}

export function expandCustomServices(services: readonly CustomService[]): CustomModel[] {
  return services.flatMap(expandCustomService);
}

export function formatTokens(value: number | undefined): string {
  if (!value) return '';
  if (value % TOKEN_K === 0) return `${value / TOKEN_K}K`;
  return String(value);
}
