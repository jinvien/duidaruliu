/**
 * @file ollama hooks
 * @description 调用 ollama 模型的接口，获取模型列表、服务启动状态
 * @returns
 */
import { useEffect } from 'react';
import { getServiceFetch } from '../host';
import { isEmbeddingModel } from '../utils/detectModel';
import { parseCapabilities, type OllamaListedModel } from '../utils/modelCapability';
import { useAppDispatch, useAppSelector } from './useStore';
import { setListedModels, setModelCapabilities, setModelsStatus } from '../store/ollamaSlice';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function keepChatModel(model: unknown): model is { name: string; capabilities?: unknown } {
  if (!isRecord(model) || typeof model.name !== 'string' || !model.name) return false;
  const details = isRecord(model.details) ? model.details : undefined;
  const parameterSize =
    details && typeof details.parameter_size === 'string' ? details.parameter_size : undefined;
  if (!parameterSize) return true;
  try {
    return !isEmbeddingModel({ name: model.name, details: { parameter_size: parameterSize } });
  } catch {
    return true;
  }
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

async function fetchShowCapabilities(
  ollamaUrl: string,
  name: string,
  signal: AbortSignal
): Promise<string[] | null> {
  const response = await getServiceFetch()(`${ollamaUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name }),
    signal,
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  const parsed = parseCapabilities(isRecord(data) ? data.capabilities : undefined);
  return parsed.capabilitiesKnown ? parsed.capabilities : null;
}

// 获取 ollama 模型列表，并记下 vision 等能力。Ollama 不可达时保持空列表，不抛到界面外。
export const useOllamaTags = (ollamaUrl: string) => {
  const dispatch = useAppDispatch();
  const ollamaTags = useAppSelector((state) => state.ollama.listedModels);
  const modelsNonce = useAppSelector((state) => state.ollama.modelsNonce);

  useEffect(() => {
    if (!ollamaUrl) {
      dispatch(setListedModels([]));
      dispatch(setModelsStatus('idle'));
      return;
    }

    const controller = new AbortController();
    let active = true;
    dispatch(setListedModels([]));
    dispatch(setModelsStatus('loading'));

    const settleCapability = (name: string, capabilities: string[] | null) => {
      if (!active) return;
      dispatch(
        setModelCapabilities({
          name,
          capabilities: capabilities ?? [],
          // 空数组也是 show 的明确结果，表示已确认没有 vision。null 才是未知。
          capabilityState: Array.isArray(capabilities) ? 'known' : 'unknown',
        })
      );
    };

    const load = async () => {
      try {
        const response = await getServiceFetch()(`${ollamaUrl}/api/tags`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`tags ${response.status}`);
        }
        const data: unknown = await response.json();
        const modelsRaw = isRecord(data) && Array.isArray(data.models) ? data.models : [];
        const models: OllamaListedModel[] = modelsRaw.filter(keepChatModel).map((model) => {
          const parsed = parseCapabilities(model.capabilities);
          return {
            name: model.name,
            capabilities: parsed.capabilities,
            capabilityState: parsed.capabilitiesKnown ? 'known' : 'pending',
          };
        });
        if (!active) return;
        dispatch(setListedModels(models));

        const unknown = models.filter((model) => model.capabilityState === 'pending');
        await mapPool(unknown, 3, async (model) => {
          if (!active) return;
          try {
            const capabilities = await fetchShowCapabilities(
              ollamaUrl,
              model.name,
              controller.signal
            );
            settleCapability(model.name, capabilities);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            settleCapability(model.name, null);
          }
        });
        if (active) dispatch(setModelsStatus('ready'));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!active) return;
        dispatch(setListedModels([]));
        dispatch(setModelsStatus('error'));
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [dispatch, ollamaUrl, modelsNonce]);

  return { ollamaTags };
};
