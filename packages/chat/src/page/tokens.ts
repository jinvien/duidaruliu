const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/** 粗略估算 token 数：中日韩字符每个算 1 个，其余约 4 个字符算 1 个。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}
