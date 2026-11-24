import { contentText, resolveTranscriptTools } from '@earendil-works/pi-ai';

import { LANG_FULLNAME } from '../ollamaStream';

import type { ImageContent, Message, ToolCall } from '@earendil-works/pi-ai';
import type { CustomModel } from '../../models/customModel';

/** 工具结果里的图片不会再发给模型，只留一句说明。 */
export const CUSTOM_TOOL_IMAGE_NOTE = '这是一张图片，当前对话不会把工具返回的图片发给模型。';

export type NeutralImage = { mimeType: string; data: string };

export type NeutralToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type NeutralMessage =
  | { role: 'system'; text: string }
  | { role: 'user'; text: string; images: NeutralImage[] }
  | {
      role: 'assistant';
      text: string;
      thinking: string;
      thinkingSignature?: string;
      toolCalls: NeutralToolCall[];
    }
  | { role: 'tool'; callId: string; text: string; isError: boolean };

export type NeutralTool = { name: string; description: string; parameters: unknown };

export type Tracking = { sessionId: string; qaId: string };

export type CustomStreamRequest = {
  model: CustomModel;
  includeImages: boolean;
  includeTools: boolean;
  lang: string;
  translateSystemPrompt: string;
  translatePostfix: string;
  temperature?: number;
  /** 用户在选择模型时的思考开关。只在服务声明了思考模式时才有意义，缺省视为开启。 */
  thinkingEnabled?: boolean;
  /** 会话与提问标识。只有模型打开 sessionHeaders 时才会写进请求。 */
  tracking?: Tracking;
  fetchImpl?: typeof fetch;
};

export function isOfficialOpenAi(url: string): boolean {
  try {
    return new URL(url).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

/**
 * default：服务没声明思考模式，请求里不带任何思考参数，交给服务端默认值。
 * on / off：服务声明了思考模式，请求里显式带上开启或关闭的参数。
 */
export type ThinkingMode = 'default' | 'on' | 'off';

export function thinkingMode(
  request: Pick<CustomStreamRequest, 'model' | 'thinkingEnabled'>
): ThinkingMode {
  if (!request.model.thinking) return 'default';
  return request.thinkingEnabled === false ? 'off' : 'on';
}

function userImages(message: Message): NeutralImage[] {
  if (message.role !== 'user' || typeof message.content === 'string') return [];
  return message.content
    .filter((part): part is ImageContent => part.type === 'image')
    .map((part) => ({ mimeType: part.mimeType || 'image/png', data: part.data.replace(/\s/g, '') }))
    .filter((image) => image.data.length > 0);
}

/**
 * 把 pi 的转录整理成中立结构。
 * 规则和 Ollama 链路一致：工具声明会插入的空 system 丢弃，翻译场景给用户消息补目标语言。
 */
export function toNeutralMessages(
  messages: readonly Message[],
  request: Pick<
    CustomStreamRequest,
    'includeImages' | 'lang' | 'translateSystemPrompt' | 'translatePostfix'
  >
): NeutralMessage[] {
  const result: NeutralMessage[] = [];
  let activeSystem = '';

  for (const message of messages) {
    if (message.role === 'system') {
      activeSystem = contentText(message.content, '');
      if (activeSystem) result.push({ role: 'system', text: activeSystem });
      continue;
    }

    if (message.role === 'user') {
      let text = contentText(message.content, '');
      if (activeSystem && activeSystem === request.translateSystemPrompt) {
        text = `${text} \n ${request.translatePostfix}${LANG_FULLNAME[request.lang]}`;
      }
      result.push({
        role: 'user',
        text,
        images: request.includeImages ? userImages(message) : [],
      });
      continue;
    }

    if (message.role === 'assistant') {
      const signed = message.content.find(
        (part) => part.type === 'thinking' && part.thinkingSignature
      );
      result.push({
        role: 'assistant',
        text: contentText(message.content, ''),
        thinking: message.content
          .filter((part) => part.type === 'thinking')
          .map((part) => part.thinking)
          .join(''),
        thinkingSignature:
          signed && signed.type === 'thinking' ? signed.thinkingSignature : undefined,
        toolCalls: message.content
          .filter((part): part is ToolCall => part.type === 'toolCall')
          .map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
      });
      continue;
    }

    if (message.role === 'toolResult') {
      result.push({
        role: 'tool',
        callId: message.toolCallId,
        text: message.content
          .map((part) => (part.type === 'image' ? CUSTOM_TOOL_IMAGE_NOTE : part.text))
          .filter((part) => part.length > 0)
          .join('\n'),
        isError: message.isError === true,
      });
    }
  }
  return result;
}

export function neutralTools(
  messages: readonly Message[],
  request: Pick<CustomStreamRequest, 'includeTools'>
): NeutralTool[] {
  if (!request.includeTools) return [];
  return resolveTranscriptTools(messages, 'none').requestTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export function dataUrl(image: NeutralImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export function systemText(messages: readonly NeutralMessage[]): string {
  return messages
    .filter(
      (message): message is Extract<NeutralMessage, { role: 'system' }> => message.role === 'system'
    )
    .map((message) => message.text)
    .join('\n\n');
}
