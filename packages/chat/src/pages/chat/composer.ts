import type { ResponseStatus } from '../../store/chatSlice';

/** 发送后的前 500ms 状态可能还是 end，但循环已经开始，不能再发。 */
export function composerCanSend(
  status: ResponseStatus,
  streaming: boolean,
  hasText: boolean,
  serverRunning: boolean
): boolean {
  return hasText && serverRunning && status === 'end' && !streaming;
}
