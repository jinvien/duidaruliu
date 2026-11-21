import type { Message } from '@/store/chatSlice';

export type AssistantSegment =
  | { type: 'text'; text: string; thinking?: string }
  | { type: 'tool'; name: string; content: string; isError?: boolean; pending?: boolean };

export type ChatBlock =
  | { kind: 'message'; message: Message; index: number }
  | {
      kind: 'assistant';
      model: string;
      segments: AssistantSegment[];
      copyText: string;
      lastIndex: number;
    };

function usableModel(model: string | undefined, fallback: string): string {
  const value = model?.trim();
  if (!value || value === 'unknown') return fallback === 'unknown' ? '' : fallback;
  return value;
}

/** 展示名优先。没有标题时去掉 mcp__服务器__ 前缀，不再把 unknown 或整段协议名直接给用户。 */
export function readableToolName(displayName?: string, toolName?: string): string {
  const display = displayName?.trim();
  const raw = toolName?.trim();
  if (display && display !== 'unknown' && !display.includes('mcp__')) {
    if (/[_-]/.test(display) && display === display.toLowerCase())
      return prettifyToolSegment(display);
    return display;
  }
  const source = raw && raw !== 'unknown' ? raw : display;
  if (!source || source === 'unknown') return '';
  return prettifyToolSegment(source);
}

function prettifyToolSegment(name: string): string {
  const parts = name.split('__').filter((part) => part.length > 0);
  const segment =
    parts[0] === 'mcp' && parts.length >= 3 ? parts.slice(2).join(' ') : parts.join(' ');
  const words = segment.replace(/[_-]+/g, ' ').trim();
  if (!words) return '';
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * 同一轮用户提问后的助手正文、工具结果和后续正文在界面上合成一块。
 * Redux 仍按条保存，避免跟进正文丢失。
 */
export function groupChatBlocks(messages: readonly Message[], selectedModel = ''): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      if (message) blocks.push({ kind: 'message', message, index });
      index += 1;
      continue;
    }
    const grouped = [message];
    let next = index + 1;
    while (
      next < messages.length &&
      (messages[next]?.role === 'assistant' || messages[next]?.role === 'tool')
    ) {
      grouped.push(messages[next] as Message);
      next += 1;
    }
    blocks.push(toAssistantBlock(grouped, index, next - 1, selectedModel));
    index = next;
  }
  return blocks;
}

function toAssistantBlock(
  messages: Message[],
  start: number,
  lastIndex: number,
  selectedModel: string
): Extract<ChatBlock, { kind: 'assistant' }> {
  const model = usableModel(
    messages.find((message) => message.role === 'assistant' && usableModel(message.model, ''))
      ?.model,
    selectedModel
  );
  const segments: AssistantSegment[] = [];
  const answers: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (!message.content.trim() && !message.thinking?.trim()) continue;
      segments.push({
        type: 'text',
        text: message.content,
        ...(message.thinking ? { thinking: message.thinking } : {}),
      });
      if (message.content.trim()) answers.push(message.content.trim());
      continue;
    }
    segments.push({
      type: 'tool',
      name: readableToolName(message.toolDisplayName, message.toolName),
      content: message.content,
      ...(message.isError ? { isError: true } : {}),
    });
  }
  return { kind: 'assistant', model, segments, copyText: answers.join('\n\n'), lastIndex };
}
