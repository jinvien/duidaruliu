import { getServiceFetch } from '../host';

export type SseEvent = {
  /** `event:` 字段。没有时为空串，协议自己看 data 里的 type。 */
  event: string;
  data: string;
};

export type SseFetchOptions = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

const DETAIL_LIMIT = 180;

function pickMessage(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  // OpenAI / Anthropic: { error: { message } }，部分网关: { message } 或 { error: "..." }
  return pickMessage(record.error) || pickMessage(record.message);
}

/** 非 2xx 响应转成错误。有可读原因时带上状态码，方便区分鉴权和限流。 */
export async function errorFromResponse(response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await response.text()).trim();
    if (body) {
      try {
        detail = pickMessage(JSON.parse(body)) || body;
      } catch {
        detail = body;
      }
    }
  } catch {
    detail = '';
  }
  if (detail.length > DETAIL_LIMIT) detail = `${detail.slice(0, DETAIL_LIMIT)}…`;
  return new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
}

/** 把一个事件块解析成 SseEvent。注释行和没有 data 的块返回 null。 */
export function parseSseBlock(block: string): SseEvent | null {
  let event = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  return { event, data: data.join('\n') };
}

/**
 * 发送请求并按 SSE 规范逐个交出事件。
 * 非 2xx、网络错误和中止都会抛出，由调用方统一收尾。
 */
export async function sseFetch(
  options: SseFetchOptions,
  onEvent: (event: SseEvent) => void
): Promise<void> {
  const { url, method = 'POST', headers, body, signal, fetchImpl = getServiceFetch() } = options;
  const response = await fetchImpl(url, { method, headers, body, signal });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new Error('Response body is not available');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drain = (flush: boolean) => {
    buffer = buffer.replace(/\r\n?/g, '\n');
    let index: number;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const parsed = parseSseBlock(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      if (parsed) onEvent(parsed);
    }
    if (flush && buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      buffer = '';
      if (parsed) onEvent(parsed);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      // \r 可能被切在两个分片之间，留一个字符到下次再规整。
      if (buffer.endsWith('\r')) {
        const tail = buffer.slice(-1);
        buffer = buffer.slice(0, -1);
        drain(false);
        buffer += tail;
      } else {
        drain(false);
      }
    }
    if (done) break;
  }
  buffer += decoder.decode();
  drain(true);
}
