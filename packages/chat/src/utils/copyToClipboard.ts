export function copyToClipboard(text: string): void {
  // 创建一个临时的文本区域
  const textArea = document.createElement('textarea');
  // 将需要复制的文本放入这个文本区域
  textArea.value = text;
  // 将文本区域添加到文档中
  document.body.appendChild(textArea);
  // 选择文本区域的内容
  textArea.select();
  // 执行复制命令
  document.execCommand('copy');
  // 移除临时文本区域
  document.body.removeChild(textArea);
}
