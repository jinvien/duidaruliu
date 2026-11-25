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
