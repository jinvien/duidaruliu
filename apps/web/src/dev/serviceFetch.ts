import { requestNeedsOriginRewrite } from '@ddrl/chat/mcp/origin';

import { parseLoopbackTarget } from './loopback';

import type { McpServerRecord } from '@ddrl/chat/mcp/origin';

export type ServiceFetchState = {
  ollamaUrl: string;
  servers: McpServerRecord[];
};

export function createWebServiceFetch(
  readState: () => ServiceFetchState,
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!parseLoopbackTarget(url)) return baseFetch(input, init);
    const state = readState();
    // 存储里的地址还没写进 Redux 时，这次请求自己的地址就是要改写的目标。
    const headers = new Headers(init?.headers);
    if (requestNeedsOriginRewrite(url, state.ollamaUrl || url, state.servers)) {
      headers.set('x-ddrl-rewrite-origin', '1');
    }
    return baseFetch(`/__ddrl/proxy?target=${encodeURIComponent(url)}`, {
      method: init?.method,
      headers,
      body: init?.body,
      signal: init?.signal,
    });
  };
}
