type ModelDetails = {
  parameter_size: string;
};

type Model = {
  name: string;
  details: ModelDetails;
};

/**
 * 判断模型是否为 embedding 模型
 * 规则：通常 embedding 模型的参数规模较小（如 100M 级别），
 * 而大模型（如 GPT、LLM）通常参数规模在 1B 以上。
 * @param model - 需要判断的模型对象
 * @returns 是否为 embedding 模型
 */
export function isEmbeddingModel(model: Model): boolean {
  const paramSize = model.details.parameter_size;
  const sizeMatch = paramSize.match(/(\d+(\.\d+)?)([MKBG])/i);

  if (!sizeMatch) return false;

  const sizeValue = parseFloat(sizeMatch[1]);
  const sizeUnit = sizeMatch[3].toUpperCase();

  // 按单位换算参数规模（M = 10^6, B = 10^9, G = 10^9 但通常不用于表示参数规模）
  const paramCount =
    sizeUnit === 'M' ? sizeValue * 1e6 : sizeUnit === 'B' ? sizeValue * 1e9 : sizeValue; // 其他情况（如无单位或未知单位）

  return paramCount <= 500e6; // 通常 embedding 模型小于 500M 参数
}
