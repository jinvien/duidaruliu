import { imageDataUrlToBase64 } from '@/utils/chatImage';

import type { ChatImage } from '@/store/chatSlice';

/** Ollama 原生 /api/chat 消息。images 为不含 data URL 前缀的 base64。 */
export type OllamaWireMessage = {
  role: string;
  content: string;
  images?: string[];
};

export function toOllamaWireMessage(
  message: { role: string; content: string; images?: ChatImage[] },
  includeImages: boolean
): OllamaWireMessage {
  const wire: OllamaWireMessage = {
    role: message.role,
    content: message.content,
  };
  if (!includeImages || message.role !== 'user' || !message.images?.length) {
    return wire;
  }

  const images = message.images
    .map((image) => imageDataUrlToBase64(image.dataUrl))
    .filter((value) => value.length > 0);
  if (images.length) {
    wire.images = images;
  }
  return wire;
}
