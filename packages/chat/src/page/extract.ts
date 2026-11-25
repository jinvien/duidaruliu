/// <reference path="./turndown-plugin-gfm.d.ts" />
import type { PageRef, PageSnapshot } from './types';

/** 防止历史记录膨胀的硬上限，不是模型上下文上限。 */
export const MAX_PAGE_CHARS = 200_000;

/** 低于这个长度的“正文”不可信，用户有选区时优先选区。 */
const MIN_ARTICLE_CHARS = 200;

const STRIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'form',
  '[hidden]',
  '[aria-hidden="true"]',
].join(',');

function resolveUrl(raw: string | null | undefined, base: string): string {
  const value = raw?.trim();
  if (!value || value.startsWith('#') || /^(javascript|data|blob):/i.test(value)) return '';
  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

function escapeUrl(url: string): string {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
}

function collapse(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function htmlToMarkdown(html: string, baseUrl: string): Promise<string> {
  const [{ default: Turndown }, { gfm }] = await Promise.all([
    import('turndown'),
    import('turndown-plugin-gfm'),
  ]);
  const service = new Turndown({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  service.use(gfm);
  service.remove(['script', 'style', 'noscript', 'template', 'iframe']);
  // 链接和图片统一按原页面地址转成绝对路径，不依赖解析环境的 baseURI。
  service.addRule('absoluteLink', {
    filter: (node) => node.nodeName === 'A',
    replacement: (content, node) => {
      const href = resolveUrl((node as Element).getAttribute('href'), baseUrl);
      if (!href || !content.trim()) return content;
      return `[${content}](${escapeUrl(href)})`;
    },
  });
  service.addRule('absoluteImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const element = node as Element;
      const src = resolveUrl(
        element.getAttribute('src') || element.getAttribute('data-src'),
        baseUrl,
      );
      if (!src) return '';
      const alt = (element.getAttribute('alt') ?? '').replace(/[\[\]\n]/g, ' ').trim();
      return `![${alt}](${escapeUrl(src)})`;
    },
  });
  return collapse(service.turndown(html));
}

/**
 * 阅读模式风格的正文提取。doc 由调用方用 snapshot.html 解析得到：
 * 浏览器里用 DOMParser，测试里用 linkedom。函数会修改 doc。
 */
export async function extractPage(doc: Document, snapshot: PageSnapshot): Promise<PageRef> {
  doc.querySelectorAll(STRIP_SELECTOR).forEach((node) => node.remove());

  const { Readability } = await import('@mozilla/readability');
  const article = new Readability(doc).parse();

  let content = '';
  if (article?.content) {
    content = await htmlToMarkdown(article.content, snapshot.url);
  }
  const selection = snapshot.selection.trim();
  const shortArticle = (article?.textContent ?? '').trim().length < MIN_ARTICLE_CHARS;
  if (!content || (selection && shortArticle)) {
    // 列表页、应用后台这类页面认不出正文，Readability 只会返回零碎内容。
    content = selection
      ? collapse(selection)
      : collapse((doc.body?.textContent ?? '').replace(/[ \t\f\v]+/g, ' '));
  }

  const description =
    snapshot.description.trim() ||
    snapshot.ogDescription.trim() ||
    (article?.excerpt ?? '').trim();

  const truncated = content.length > MAX_PAGE_CHARS;
  if (truncated) content = content.slice(0, MAX_PAGE_CHARS);

  const ref: PageRef = {
    url: snapshot.url,
    title: (article?.title || snapshot.title || snapshot.url).trim(),
    description,
    content,
    truncated,
  };
  if (article?.siteName) ref.siteName = article.siteName;
  return ref;
}

/** 浏览器里解析快照。DOMParser 产出的文档不会执行脚本，也不会加载资源。 */
export function parseSnapshotHtml(snapshot: PageSnapshot): Document {
  const doc = new DOMParser().parseFromString(snapshot.html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', snapshot.url);
  doc.head.prepend(base);
  return doc;
}
