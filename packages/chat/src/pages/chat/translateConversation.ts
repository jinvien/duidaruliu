import { settleAgent } from '../../agent/runtime';
import { clearSessionToolAllows } from '../../mcp/approval';
import { setMessages } from '../../store/chatSlice';

import type { OllamaModelParams } from '../../hooks/useOllama';
import type { Message } from '../../store/chatSlice';

type Dispatch = (action: ReturnType<typeof setMessages>) => unknown;

/**
 * 划词翻译会整段换成新的转录。本会话允许不能跟着带过去。
 */
export async function replaceConversationForTranslate(options: {
  dispatch: Dispatch;
  messages: Message[];
  saveCurrent: boolean;
  send: (override?: OllamaModelParams) => Promise<void>;
  override?: OllamaModelParams;
  onReplaced?: () => void;
}) {
  await settleAgent();
  clearSessionToolAllows();
  await options.dispatch(
    setMessages({
      messages: options.messages,
      isSaveCurrent: options.saveCurrent,
    })
  );
  options.onReplaced?.();
  await options.send(options.override);
}
