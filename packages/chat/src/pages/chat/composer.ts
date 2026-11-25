import type { ResponseStatus } from '../../store/chatSlice';

/** 停止按钮只跟这一轮的界面状态走。流结束后 isStreaming 还会晚一拍，不能拿它把按钮留住。 */
export function composerStopVisible(status: ResponseStatus): boolean {
  return status === 'waiting' || status === 'outputting' || status === 'tool';
}

/** 外层快捷指令用了 Cascader。空格和回车冒泡上去会被当成打开菜单，并 preventDefault。 */
export function composerKeyStopsCascader(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

export type ComposerEnterAction = 'send' | 'break-line' | 'insert-line' | 'ignore';

/**
 * 裸回车发送。Shift+Enter 交给输入框自己换行。
 * Cmd/Ctrl+Enter 浏览器不会插入换行，要自己补一个。
 */
export function composerEnterAction(input: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  composing: boolean;
}): ComposerEnterAction {
  if (input.composing || input.key !== 'Enter') return 'ignore';
  if (input.metaKey || input.ctrlKey) return 'insert-line';
  if (input.shiftKey) return 'break-line';
  return 'send';
}

/** 发送后的前 500ms 状态可能还是 end，但循环已经开始，不能再发。 */
export function composerCanSend(
  status: ResponseStatus,
  streaming: boolean,
  hasText: boolean,
  serverRunning: boolean
): boolean {
  return hasText && serverRunning && status === 'end' && !streaming;
}
