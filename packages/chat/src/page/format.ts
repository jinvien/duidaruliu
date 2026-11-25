import type { PageRef } from './types';

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 把页面引用拼成发给模型的文本。正文里的结束标签要转义，免得提前闭合。 */
export function formatPageForModel(page: PageRef, userText: string): string {
  const body = page.content.replace(/<\/page>/gi, '<\\/page>');
  const parts = [`<page url="${attr(page.url)}" title="${attr(page.title)}">`];
  if (page.description) parts.push(page.description, '');
  parts.push(body);
  if (page.truncated) parts.push('', '(正文过长，已截断)');
  parts.push('</page>');
  const block = parts.join('\n');
  return userText ? `${block}\n\n${userText}` : block;
}
