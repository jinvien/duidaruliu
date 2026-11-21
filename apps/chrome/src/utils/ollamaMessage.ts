import { imageDataUrlToBase64 } from '@/utils/chatImage';

import type { ChatImage } from '@/store/chatSlice';

/** 工具结果里的图片不能放进 Ollama 的 images，只能换成说明。 */
export const OLLAMA_TOOL_IMAGE_NOTE = '这是一张图片，当前对话不会把它作为图像发给本地模型。';

export type OllamaFunctionCall = {
  type: 'function';
  function: { name: string; arguments: Record<string, unknown> };
};

/** Ollama 原生 /api/chat 消息。images 为不含 data URL 前缀的 base64。 */
export type OllamaWireMessage = {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: OllamaFunctionCall[];
  tool_name?: string;
};

/** data URL 图片，或 Pi ImageContent 里已经去掉前缀的 base64。 */
export type OllamaWireImage = ChatImage | { data: string };

function wireImageBase64(image: OllamaWireImage): string {
  if ('dataUrl' in image) return imageDataUrlToBase64(image.dataUrl);
  return image.data.replace(/\s/g, '');
}

export function toOllamaWireMessage(
  message: { role: string; content: string; images?: OllamaWireImage[] },
  includeImages: boolean
): OllamaWireMessage {
  const wire: OllamaWireMessage = {
    role: message.role,
    content: message.content,
  };
  if (!includeImages || message.role !== 'user' || !message.images?.length) {
    return wire;
  }

  const images = message.images.map(wireImageBase64).filter((value) => value.length > 0);
  if (images.length) {
    wire.images = images;
  }
  return wire;
}
