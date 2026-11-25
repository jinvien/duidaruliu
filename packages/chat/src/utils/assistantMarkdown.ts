const CODE_SEGMENT = /```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[^`\n]+`/g;

/**
 * 代码片段以外的 `<` 会让 Markdown 把 `Vec<T>` 当成 HTML 标签，表格会被拆开。
 * `<think>` 要留给 rehype-raw，所以只保护这一个标签。
 */
function escapeLooseHtml(text: string): string {
  const tags: string[] = [];
  const masked = text.replace(/<\/?think>/g, (tag) => {
    tags.push(tag);
    return `\u0000${tags.length - 1}\u0000`;
  });
  return masked.replace(/</g, '&lt;').replace(/\u0000(\d+)\u0000/g, (_, index: string) => {
    return tags[Number(index)] ?? '';
  });
}

function escapeOutsideCode(raw: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const match of raw.matchAll(CODE_SEGMENT)) {
    const index = match.index ?? 0;
    parts.push(escapeLooseHtml(raw.slice(last, index)));
    parts.push(match[0]);
    last = index + match[0].length;
  }
  const rest = raw.slice(last);
  const fenceAt = rest.search(/```|~~~/);
  if (fenceAt >= 0) {
    parts.push(escapeLooseHtml(rest.slice(0, fenceAt)));
    parts.push(rest.slice(fenceAt));
  } else {
    parts.push(escapeLooseHtml(rest));
  }
  return parts.join('');
}

function escapeThinkContent(raw: string) {
  return raw
    .replace(/<think>([\s\S]*?)<\/think>/g, (_, thought: string) => {
      return `<think>${thought.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</think>`;
    })
    .replace(/<think>([\s\S]*?)(?=<think>|<\/think>|$)/g, (_, thought: string) => {
      return `<think>${thought.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
    });
}

/** 送给 Markdown 渲染前的正文。代码里的 `<` 保持原样，其余转成实体。 */
export function prepareAssistantMarkdown(raw: string): string {
  return escapeThinkContent(escapeOutsideCode(raw));
}
