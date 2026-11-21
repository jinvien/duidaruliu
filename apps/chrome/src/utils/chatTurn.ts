import type { Message } from '@/store/chatSlice';

/** 重新生成时删掉最后一条用户消息之后的助手回合和工具结果。 */
export function dropLastAssistantTurn(messages: Message[]): Message[] {
  let end = messages.length;
  while (
    end > 0 &&
    (messages[end - 1]?.role === 'tool' || messages[end - 1]?.role === 'assistant')
  ) {
    end -= 1;
  }
  return messages.slice(0, end);
}
