/**
 * 右键“发送到对答如流”的请求通道。
 * background 也会引用这个文件，所以不能 import '@ddrl/chat' 总入口，
 * 否则整个聊天界面会被打进 service worker，启动即崩。
 */

const PENDING_KEY = 'pendingPageRequest';
/** 超过这个时间的请求视为过期，避免很久以前的右键在这次打开时被执行。 */
const PENDING_TTL_MS = 60_000;

export type PendingPageRequest = { tabId: number; at: number };

/** background 在右键点击时调用。侧边栏没开就等它启动后读取，开着就走 onChanged。 */
export async function postPageRequest(tabId: number) {
  const request: PendingPageRequest = { tabId, at: Date.now() };
  await chrome.storage.session.set({ [PENDING_KEY]: request });
}

export function subscribePageRequest(listener: (request: { tabId: number }) => void) {
  let active = true;
  const consume = async () => {
    const stored = await chrome.storage.session.get(PENDING_KEY);
    const request = stored[PENDING_KEY] as PendingPageRequest | undefined;
    if (!request) return;
    await chrome.storage.session.remove(PENDING_KEY);
    if (!active || Date.now() - request.at > PENDING_TTL_MS) return;
    listener({ tabId: request.tabId });
  };
  void consume();
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'session' && changes[PENDING_KEY]?.newValue) void consume();
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
