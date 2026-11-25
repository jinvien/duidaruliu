import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import { parseLoopbackTarget } from '../src/dev/loopback';

export { parseLoopbackTarget };

/** 浏览器跨站请求会带上别人的 Origin。只放行开发服务器自己。 */
export function callerMayProxy(headers: http.IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (!origin || Array.isArray(origin)) return !origin;
  const host = headers.host;
  if (!host || Array.isArray(host)) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function skipRequestHeader(name: string) {
  return (
    name === 'host' ||
    name === 'connection' ||
    name === 'content-length' ||
    name === 'transfer-encoding' ||
    name === 'keep-alive' ||
    name === 'origin' ||
    name === 'accept-encoding' ||
    name === 'referer' ||
    name.startsWith('sec-') ||
    name === 'x-ddrl-rewrite-origin'
  );
}

function upstreamHeaders(headers: http.IncomingHttpHeaders, target: URL, rewriteOrigin: boolean) {
  const next: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (skipRequestHeader(key.toLowerCase())) continue;
    if (value !== undefined) next[key] = value;
  }
  // 不把页面自己的 Origin 带给本机服务。需要对齐扩展 DNR 时，改成目标自己的 origin。
  if (rewriteOrigin) next.origin = target.origin;
  return next;
}

/** Node 已经拆过 chunked。再把 transfer-encoding 写回浏览器会让流永远等不到结束。 */
export function downstreamHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (
      name === 'connection' ||
      name === 'keep-alive' ||
      name === 'proxy-connection' ||
      name === 'transfer-encoding' ||
      name === 'upgrade' ||
      name === 'trailer' ||
      name === 'te' ||
      name === 'content-encoding'
    ) {
      continue;
    }
    if (value !== undefined) next[key] = value;
  }
  return next;
}

export function forwardLoopback(options: {
  target: URL;
  method: string;
  headers: http.IncomingHttpHeaders;
  body?: Uint8Array;
  signal?: AbortSignal;
  rewriteOrigin: boolean;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = options.target.protocol === 'https:' ? https : http;
    const req = lib.request(
      options.target,
      {
        method: options.method,
        headers: upstreamHeaders(options.headers, options.target, options.rewriteOrigin),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    const fail = (error: Error) => {
      req.destroy(error);
      reject(error);
    };
    if (options.signal) {
      if (options.signal.aborted) {
        fail(new Error('aborted'));
        return;
      }
      options.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true });
    }
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export function pipeLoopback(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: URL,
  rewriteOrigin: boolean,
) {
  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.request(
    target,
    {
      method: clientReq.method,
      headers: upstreamHeaders(clientReq.headers, target, rewriteOrigin),
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, downstreamHeaders(upstreamRes.headers));
      upstreamRes.pipe(clientRes);
    },
  );
  const stop = () => {
    upstream.destroy();
  };
  // 请求体读完也会触发 req close。那时响应还在流，不能把上游掐掉。
  clientReq.on('aborted', stop);
  clientRes.on('close', () => {
    if (!clientRes.writableFinished) stop();
  });
  upstream.on('error', (error) => {
    if (!clientRes.headersSent) {
      clientRes.statusCode = 502;
      clientRes.setHeader('content-type', 'text/plain; charset=utf-8');
      clientRes.end(error.message || 'bad gateway');
      return;
    }
    clientRes.end();
  });
  clientReq.pipe(upstream);
}

export function handleLoopbackProxy(req: IncomingMessage, res: ServerResponse) {
  if (!callerMayProxy(req.headers)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  const requestUrl = new URL(req.url ?? '', 'http://127.0.0.1');
  const target = parseLoopbackTarget(requestUrl.searchParams.get('target') ?? '');
  if (!target) {
    res.statusCode = 400;
    res.end('blocked');
    return;
  }
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (typeof origin === 'string') res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'access-control-allow-headers',
      req.headers['access-control-request-headers'] || 'content-type, x-ddrl-rewrite-origin',
    );
    res.setHeader('access-control-max-age', '600');
    res.statusCode = 204;
    res.end();
    return;
  }
  pipeLoopback(req, res, target, req.headers['x-ddrl-rewrite-origin'] === '1');
}

/** 只在 vite dev 里转发回环地址。生产构建没有这条路径。 */
export function loopbackProxyPlugin(): Plugin {
  return {
    name: 'ddrl-loopback-proxy',
    configureServer(server) {
      server.middlewares.use('/__ddrl/proxy', (req, res) => {
        handleLoopbackProxy(req, res);
      });
    },
  };
}
