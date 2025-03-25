/**
 * @file ollama hooks
 * @description 调用 ollama 模型的接口，获取模型列表、服务启动状态
 * @returns
 */
import { useState, useEffect } from 'react';
import { isEmbeddingModel } from '@/utils/detectModel';

export type OllamaModelOptions = {
  temperature?: number;
  num_ctx?: number;
  num_predict?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  mirostat?: number;
  mirostat_eta?: number;
  mirostat_tau?: number;
  repeat_last_n?: number;
  repeat_penalty?: number;
  seed?: number;
  stop?: string;
};

export type OllamaModelParams = {
  model: string;
  options?: OllamaModelOptions;
  keep_alive?: number;
};

export type OllamaModelInfo = {
  name: string;
};

// 获取 ollama 模型列表
export const useOllamaTags = (ollamaUrl: string) => {
  const [ollamaTags, setOllamaTags] = useState<OllamaModelInfo[]>([]);

  useEffect(() => {
    const fetchOllamaTags = async () => {
      const response = await fetch(`${ollamaUrl}/api/tags`);
      const data = await response.json();
      const filteredData = data.models.filter((model: any) => !isEmbeddingModel(model));
      setOllamaTags(filteredData);
    };

    fetchOllamaTags();
  }, []);

  return { ollamaTags };
};
