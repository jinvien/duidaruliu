import { parseHTML } from 'linkedom';

import { extractPage, MAX_PAGE_CHARS } from '../src/page/extract';
import { formatPageForModel } from '../src/page/format';
import { estimateTokens } from '../src/page/tokens';

import type { PageSnapshot } from '../src/page/types';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

const URL_BASE = 'https://example.com/blog/post.html';

function snapshotOf(html: string, partial: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: URL_BASE,
    title: 'fallback title',
    lang: 'zh',
    description: '',
    ogDescription: '',
    selection: '',
    html,
    ...partial,
  };
}

function docOf(snapshot: PageSnapshot): Document {
  return parseHTML(snapshot.html).document as unknown as Document;
}

const paragraph = (n: number) =>
  `<p>第 ${n} 段正文内容，这里写了足够多的文字，用来让提取算法认定这是文章主体，包括逗号、句号和一些细节描述。` +
  `Readability needs enough prose, so this sentence is long enough, with commas, and clauses, to count as content.</p>`;

const ARTICLE_HTML = `<!doctype html><html lang="zh"><head>
<title>文章标题 - 站点</title>
<meta name="description" content="meta 描述">
<meta property="og:description" content="og 描述">
<script>window.tracker = 1;</script><style>.x{color:red}</style>
</head><body>
<nav><ul><li><a href="/home">首页</a></li><li><a href="/about">关于</a></li><li><a href="/login">登录</a></li></ul></nav>
<div class="ad-banner" aria-hidden="true">广告：立即购买</div>
<article>
<h1>文章标题</h1>
${[1, 2, 3, 4, 5, 6].map(paragraph).join('\n')}
<p>参见 <a href="../ref/a.html">相对链接</a> 和 <a href="javascript:void(0)">脚本链接</a>。</p>
<img src="/img/pic.png" alt="配图">
<img src="data:image/png;base64,AAAA" alt="内联图">
<pre><code>const answer = 42;\nconsole.log(answer);</code></pre>
<table><thead><tr><th>名称</th><th>数量</th></tr></thead><tbody><tr><td>苹果</td><td>3</td></tr></tbody></table>
</article>
<aside class="related"><h3>相关推荐</h3><ul><li><a href="/x">热门文章一</a></li><li><a href="/y">热门文章二</a></li></ul></aside>
<footer>版权所有 备案号 12345</footer>
<script>document.write('late script')</script>
</body></html>`;

async function testArticle() {
  const snapshot = snapshotOf(ARTICLE_HTML, {
    description: 'meta 描述',
    ogDescription: 'og 描述',
  });
  const page = await extractPage(docOf(snapshot), snapshot);

  assert(page.content.includes('第 1 段正文内容'), 'keeps article body');
  assert(page.content.includes('第 6 段正文内容'), 'keeps all paragraphs');
  assert(!page.content.includes('tracker'), 'drops script');
  assert(!page.content.includes('color:red'), 'drops style');
  assert(!page.content.includes('广告'), 'drops aria-hidden ad block');
  assert(!page.content.includes('首页'), 'drops nav');
  assert(!page.content.includes('热门文章'), 'drops aside');
  assert(!page.content.includes('late script'), 'drops trailing script');
  assert(page.content.includes('```'), 'renders fenced code');
  assert(page.content.includes('const answer = 42;'), 'keeps code text');
  assert(/\|\s*名称\s*\|\s*数量\s*\|/.test(page.content), 'renders gfm table header');
  assert(/\|\s*苹果\s*\|\s*3\s*\|/.test(page.content), 'renders gfm table row');
  assert(
    page.content.includes('](https://example.com/ref/a.html)'),
    'absolutizes relative links'
  );
  assert(!page.content.includes('javascript:'), 'drops javascript links');
  assert(page.content.includes('![配图](https://example.com/img/pic.png)'), 'absolutizes images');
  assert(!page.content.includes('data:image'), 'drops data uri images');
  assert(page.description === 'meta 描述', 'prefers meta description');
  assert(page.url === URL_BASE, 'keeps url');
  assert(page.title.length > 0, 'has title');
  assert(page.truncated === false, 'not truncated');
}

async function testDescriptionOrder() {
  const og = snapshotOf(ARTICLE_HTML, { ogDescription: 'og 描述' });
  const ogPage = await extractPage(docOf(og), og);
  assert(ogPage.description === 'og 描述', 'falls back to og description');

  const none = snapshotOf(ARTICLE_HTML);
  const nonePage = await extractPage(docOf(none), none);
  assert(nonePage.description.length > 0, 'falls back to readability excerpt');
}

async function testFallback() {
  const html = `<html><head><title>应用</title></head><body><div><span>仪表盘</span><span>订单 12</span></div></body></html>`;
  const plain = snapshotOf(html);
  const plainPage = await extractPage(docOf(plain), plain);
  assert(plainPage.content.includes('仪表盘'), 'falls back to body text');
  assert(plainPage.title === '应用', 'falls back to snapshot title');

  const selected = snapshotOf(html, { selection: '选中的片段' });
  const selectedPage = await extractPage(docOf(selected), selected);
  assert(selectedPage.content === '选中的片段', 'prefers selection when no article');
}

async function testTruncate() {
  const long = snapshotOf(
    `<html><body><div>${'字'.repeat(MAX_PAGE_CHARS + 500)}</div></body></html>`
  );
  const page = await extractPage(docOf(long), long);
  assert(page.truncated === true, 'marks truncated');
  assert(page.content.length === MAX_PAGE_CHARS, 'cuts to the limit');
}

function testFormat() {
  const text = formatPageForModel(
    {
      url: 'https://a.com/?q="x"',
      title: 'T "1"',
      description: '描述',
      content: '正文 </page> 注入',
      truncated: true,
    },
    '总结全文'
  );
  assert(text.startsWith('<page url="https://a.com/?q=&quot;x&quot;" title="T &quot;1&quot;">'), 'header');
  assert(text.includes('描述\n\n正文'), 'description before content');
  assert(!/<\/page>\s*注入/.test(text), 'escapes closing tag in content');
  assert(text.includes('已截断'), 'notes truncation');
  assert(text.endsWith('</page>\n\n总结全文'), 'user text after block');

  const bare = formatPageForModel(
    { url: 'u', title: 't', description: '', content: 'c', truncated: false },
    ''
  );
  assert(bare === '<page url="u" title="t">\nc\n</page>', 'bare block');
}

function testTokens() {
  assert(estimateTokens('') === 0, 'empty tokens');
  assert(estimateTokens('你好世界') === 4, 'cjk counts one each');
  assert(estimateTokens('abcdefgh') === 2, 'latin counts per four chars');
  assert(estimateTokens('你好abcd') === 3, 'mixed');
}

async function main() {
  await testArticle();
  await testDescriptionOrder();
  await testFallback();
  await testTruncate();
  testFormat();
  testTokens();
  if (failed) {
    console.error(`${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('pageExtract ok');
}

void main();
