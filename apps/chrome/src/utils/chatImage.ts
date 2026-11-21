import type { Message, RoleType, ToolCallRecord } from '@/store/chatSlice';

export const MAX_CHAT_IMAGES = 4;

const MAX_IMAGE_EDGE = 1280;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** 存进 historyConversations 的 data URL 大约控制在这个长度，约 200–400KB。 */
const TARGET_DATA_URL_CHARS = 320 * 1024;
const IMAGE_PREFIX = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;
const ROLES = new Set<RoleType>(['user', 'assistant', 'system', 'tool']);

const EXT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export type ChatImageErrorReason = 'unsupported' | 'tooLarge' | 'readFailed';

export class ChatImageError extends Error {
  reason: ChatImageErrorReason;

  constructor(reason: ChatImageErrorReason) {
    super(reason);
    this.name = 'ChatImageError';
    this.reason = reason;
  }
}

export function imageDataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const header = comma >= 0 ? dataUrl.slice(0, comma) : '';
  const payload = comma >= 0 && header.includes('base64') ? dataUrl.slice(comma + 1) : dataUrl;
  return payload.replace(/\s/g, '');
}

export function isChatImage(value: unknown): value is { dataUrl: string } {
  if (!value || typeof value !== 'object') return false;
  const dataUrl = (value as { dataUrl?: unknown }).dataUrl;
  if (typeof dataUrl !== 'string' || !IMAGE_PREFIX.test(dataUrl)) return false;
  const payload = imageDataUrlToBase64(dataUrl);
  return payload.length > 0 && /^[a-z0-9+/=]+$/i.test(payload);
}

export function normalizeStoredMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.content !== 'string') return null;
  if (typeof value.role !== 'string' || !ROLES.has(value.role as RoleType)) return null;

  const message: Message = {
    role: value.role as RoleType,
    content: value.content,
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now(),
  };
  if (typeof value.model === 'string') {
    message.model = value.model;
  }
  if (Array.isArray(value.images)) {
    const images = value.images.filter(isChatImage);
    if (images.length) {
      message.images = images.map((image) => ({ dataUrl: image.dataUrl }));
    }
  }
  if (typeof value.thinking === 'string' && value.thinking) message.thinking = value.thinking;
  const toolCalls = normalizeToolCalls(value.toolCalls);
  if (toolCalls) message.toolCalls = toolCalls;
  if (typeof value.toolCallId === 'string') message.toolCallId = value.toolCallId;
  if (typeof value.toolName === 'string') message.toolName = value.toolName;
  if (typeof value.toolDisplayName === 'string' && value.toolDisplayName) {
    message.toolDisplayName = value.toolDisplayName;
  }
  if (typeof value.isError === 'boolean') message.isError = value.isError;
  return message;
}

function normalizeToolCalls(raw: unknown): ToolCallRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const calls = raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.name !== 'string') return [];
    const args = value.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
    return [{ id: value.id, name: value.name, arguments: args as Record<string, unknown> }];
  });
  return calls.length ? calls : undefined;
}

function resolveImageType(file: File): string | null {
  const fromMime = EXT_TYPE[file.type.replace('image/', '')];
  if (fromMime) return fromMime;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPE[ext] ?? null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new ChatImageError('readFailed'));
    };
    reader.onerror = () => reject(new ChatImageError('readFailed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ChatImageError('readFailed'));
    image.src = dataUrl;
  });
}

function renderJpeg(image: HTMLImageElement, maxEdge: number, quality: number): string {
  const longest = Math.max(image.width, image.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ChatImageError('readFailed');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function maybeCompress(dataUrl: string, mediaType: string): Promise<string> {
  if (mediaType !== 'image/gif' && dataUrl.length <= TARGET_DATA_URL_CHARS) return dataUrl;

  const image = await loadImage(dataUrl);
  if (!image.width || !image.height) throw new ChatImageError('readFailed');

  let edge = Math.min(MAX_IMAGE_EDGE, Math.max(image.width, image.height));
  let quality = 0.8;
  let best = renderJpeg(image, edge, quality);

  for (let attempt = 0; attempt < 8 && best.length > TARGET_DATA_URL_CHARS; attempt += 1) {
    if (quality > 0.5) {
      quality = Math.round((quality - 0.12) * 100) / 100;
    } else if (edge > 480) {
      edge = Math.max(480, Math.round(edge * 0.75));
    } else {
      break;
    }
    const next = renderJpeg(image, edge, quality);
    if (next.length < best.length) best = next;
  }

  if (mediaType !== 'image/gif' && dataUrl.length < best.length) return dataUrl;
  return best;
}

export async function fileToChatImage(file: File): Promise<{ dataUrl: string }> {
  const mediaType = resolveImageType(file);
  if (!mediaType) {
    throw new ChatImageError('unsupported');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ChatImageError('tooLarge');
  }

  const raw = await readFileAsDataUrl(file);
  const dataUrl = IMAGE_PREFIX.test(raw)
    ? raw
    : `data:${mediaType};base64,${imageDataUrlToBase64(raw)}`;
  const compressed = await maybeCompress(dataUrl, mediaType);
  if (!isChatImage({ dataUrl: compressed })) {
    throw new ChatImageError('readFailed');
  }
  return { dataUrl: compressed };
}
