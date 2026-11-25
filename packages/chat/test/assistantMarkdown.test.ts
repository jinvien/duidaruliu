import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { prepareAssistantMarkdown } from '../src/utils/assistantMarkdown';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function renderMd(raw: string) {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      children: prepareAssistantMarkdown(raw),
      rehypePlugins: [rehypeRaw],
      remarkPlugins: [remarkGfm],
    })
  );
}

function main() {
  const quote = renderMd('或者理解成：\n\n> 给 Babel / TypeScript transformer 一个标记，让它在编译阶段自动生成代码。');
  assert(quote.includes('<blockquote>'), 'a quote line becomes a blockquote');
  assert(quote.includes('自动生成代码'), 'quote text stays intact');
  assert(!quote.includes('&gt; 给'), 'the quote marker is not left as text');

  const generic = renderMd('| Rust | TS |\n| --- | --- |\n| Vec<T> | T[] |');
  assert(generic.includes('<table>'), 'a generic cell still produces a table');
  assert((generic.match(/<td>/g) || []).length === 2, 'both generic cells survive');
  assert(generic.includes('Vec&lt;T&gt;'), 'Vec<T> stays visible text');
  assert(!generic.includes('<t>'), 'Vec<T> is not parsed as an HTML tag');

  const coded = renderMd('| Rust | TS |\n| --- | --- |\n| `Vec<T>` | `Array<T>` |');
  assert(coded.includes('<code>Vec&lt;T&gt;</code>'), 'inline code keeps the generic');
  assert(!coded.includes('&amp;lt;'), 'code is not double escaped');

  const thought = renderMd('前文 <think>a < b</think> 后文 <T>');
  assert(thought.includes('<think>'), 'think tags stay for the custom renderer');
  assert(thought.includes('a &lt; b') || thought.includes('a &lt; b&gt;'), 'text inside think is escaped');
  assert(!thought.includes('<t>'), 'a trailing generic is not an HTML tag');

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('assistant markdown fixtures passed');
}

main();
