type StreamingFetchOptions = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
  signal?: AbortSignal;
};

type OllamaResponseObj = {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
};

type StreamingFetchCallbacks = {
  onUpdate: (chunk: OllamaResponseObj) => void;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
};

/**
 * 发送流式请求并处理数据块
 * @param options 请求配置
 * @param onUpdate 接收数据块的回调
 * @param onError 错误处理回调（可选）
 * @param onSuccess 流式传输完成回调（可选）
 * @returns Promise<void>
 */

export async function streamingFetch(
  options: StreamingFetchOptions,
  callbacks: StreamingFetchCallbacks
): Promise<void> {
  const { onUpdate, onError, onSuccess } = callbacks;

  try {
    const { url, method = 'GET', headers, body, signal } = options;

    const response = await fetch(url, { method, headers, body, signal });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is not available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // 缓冲区管理变量
    let buffer = '';
    /**​ JSON解析缓冲区 */
    let jsonBuffer = '';

    let done = false;
    while (!done) {
      const { done: readerDone, value } = await reader.read();
      done = readerDone;

      if (value) {
        // ​**优化解码方式**
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // ​**流式JSON解析逻辑**
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);

          try {
            // ​**组合不完整JSON片段**
            jsonBuffer += line;
            const data = JSON.parse(jsonBuffer);

            // ​**成功解析后重置缓冲区**
            jsonBuffer = '';
            if (onUpdate) onUpdate(data);
          } catch (e) {
            // ​**容忍不完整JSON继续累积**
            if (!(e instanceof SyntaxError)) {
              throw e;
            }
          }
        }
      }
    }

    // ​**处理最终残留数据**
    try {
      if (jsonBuffer) {
        const data = JSON.parse(jsonBuffer);
        if (onUpdate) onUpdate(data);
      }
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const error = new Error(`Final JSON error: ${e.message} Data: ${jsonBuffer}`);
      if (onError) onError(error);
    }
  } catch (e) {
    if (onError) {
      onError(e instanceof Error ? e : new Error(String(e)));
    } else {
      throw e;
    }
  }
}
