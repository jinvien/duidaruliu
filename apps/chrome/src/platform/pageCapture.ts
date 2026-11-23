import { PageCaptureError } from '@ddrl/chat';
import type { PageSnapshot } from '@ddrl/chat';

import { queryCurrentTab } from '@/utils/tab';

/**
 * 注入页面执行的采集函数，固定不变，只读 DOM。
 * 必须自包含：executeScript 会把它序列化后送进页面，不能引用外层变量。
 * 正文提取不在这里做，交给侧边栏。
 */
function collectPage(): PageSnapshot {
  const meta = (selector: string) =>
    document.querySelector(selector)?.getAttribute('content') ?? '';
  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang,
    description: meta('meta[name="description" i]'),
    ogDescription: meta('meta[property="og:description" i]'),
    selection: String(window.getSelection() ?? ''),
    html: document.documentElement.outerHTML,
  };
}

const SUPPORTED_PROTOCOL = /^(https?|file):/i;
const FORBIDDEN_MESSAGE = /cannot access|cannot be scripted|extensions gallery|no tab with id/i;

export async function captureTab(tabId?: number): Promise<PageSnapshot> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = tabId == null ? await queryCurrentTab() : await chrome.tabs.get(tabId);
  } catch {
    throw new PageCaptureError('failed');
  }
  if (tab?.id == null) throw new PageCaptureError('failed');
  // chrome://、扩展页、新标签页等拿不到，tab.url 缺失时也按不支持处理。
  if (!tab.url || !SUPPORTED_PROTOCOL.test(tab.url)) throw new PageCaptureError('unsupported');

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPage,
    });
    if (!injection?.result) throw new PageCaptureError('failed');
    return injection.result;
  } catch (error) {
    if (error instanceof PageCaptureError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PageCaptureError(FORBIDDEN_MESSAGE.test(message) ? 'unsupported' : 'failed', message);
  }
}

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
