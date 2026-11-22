import type { ResponseStatus } from '../../store/chatSlice';

/** 停止按钮只跟这一轮的界面状态走。流结束后 isStreaming 还会晚一拍，不能拿它把按钮留住。 */
export function composerStopVisible(status: ResponseStatus): boolean {
  return status === 'waiting' || status === 'outputting' || status === 'tool';
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
