import {
  McpClient,
  StreamableHttpTransport,
  validateMcpServerConfig,
} from '@earendil-works/pi-mcp';

import { getServiceFetch } from '../host';
import { headerRecord, type McpServerRecord } from './types';

type McpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type McpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'auth' | 'stdio';

export type McpToolSummary = {
  name: string;
  description?: string;
};

export type McpServerRuntime = {
  name: string;
  status: McpConnectionStatus;
  detail?: string;
  tools: McpToolSummary[];
};

type StoredTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type Session = {
  client: McpClient;
  signature: string;
  tools: McpToolSummary[];
  definitions: StoredTool[];
};

export type CallableMcpTool = StoredTool & {
  serverName: string;
  call: (
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<{
    content?: unknown;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
};

let onToolsChanged: (() => void) | undefined;

export function setMcpToolsChangedListener(listener: (() => void) | undefined) {
  onToolsChanged = listener;
}

function definitionsFrom(
  listed: {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }[]
): StoredTool[] {
  return listed.map((tool) => ({
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
  }));
}

function summariesFrom(definitions: StoredTool[]): McpToolSummary[] {
  return definitions.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
  }));
}

async function reloadServerTools(name: string, client: McpClient) {
  const listed = await client.listTools();
  const current = sessions.get(name);
  if (!current || current.client !== client) return;
  current.definitions = definitionsFrom(listed);
  current.tools = summariesFrom(current.definitions);
  snapshot = snapshot.map((item) =>
    item.name === name ? { ...item, status: 'connected', tools: current.tools } : item
  );
  emit();
  onToolsChanged?.();
}

const CLIENT_INFO = { name: 'duidaruliu', version: '0.0.4' };

let generation = 0;
let sessions = new Map<string, Session>();
let snapshot: McpServerRuntime[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeMcpRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMcpRuntime(): McpServerRuntime[] {
  return snapshot;
}

export function listCallableMcpTools(): CallableMcpTool[] {
  const callable: CallableMcpTool[] = [];
  for (const [serverName, session] of sessions) {
    for (const tool of session.definitions) {
      callable.push({
        ...tool,
        serverName,
        call: (args, signal) => session.client.callTool(tool.name, args, { signal }),
      });
    }
  }
  return callable;
}

function signature(server: McpServerRecord): string {
  return JSON.stringify({
    url: server.url,
    headers: headerRecord(server.headers),
    timeout: server.timeout,
    enabled: server.enabled,
  });
}

export function inspectMcpServer(
  server: McpServerRecord
):
  | { ok: true; url: string; headers: Record<string, string>; timeoutMs: number }
  | { ok: false; status: 'stdio' | 'error'; detail?: string } {
  if (server.command && !server.url) return { ok: false, status: 'stdio' };
  const result = validateMcpServerConfig(server.name, {
    url: server.url,
    headers: headerRecord(server.headers),
    enabled: server.enabled,
    timeout: server.timeout,
    ...(server.command ? { command: server.command } : {}),
  });
  if (result.kind === 'stdio') return { ok: false, status: 'stdio' };
  if (result.kind === 'invalid') return { ok: false, status: 'error', detail: result.error };
  return {
    ok: true,
    url: result.config.url,
    headers: result.config.headers ?? {},
    timeoutMs: (result.config.timeout ?? server.timeout) * 1000,
  };
}

function isAuthRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; status?: number };
  return value.name === 'McpAuthRequiredError' || value.status === 401;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error);
}

function idleRuntime(server: McpServerRecord): McpServerRuntime {
  return { name: server.name, status: 'idle', tools: [] };
}

async function connectServer(
  server: McpServerRecord,
  fetchImpl: McpFetch,
  gen: number
): Promise<McpServerRuntime> {
  const inspected = inspectMcpServer(server);
  if (!server.enabled) return idleRuntime(server);
  if (!inspected.ok) {
    return { name: server.name, status: inspected.status, detail: inspected.detail, tools: [] };
  }

  const client = new McpClient({
    ...CLIENT_INFO,
    requestTimeoutMs: inspected.timeoutMs,
  });
  const transport = new StreamableHttpTransport({
    url: inspected.url,
    headers: inspected.headers,
    fetch: (input, init) => fetchImpl(input, init),
  });
  try {
    await client.connect(transport);
    if (gen !== generation) {
      await client.close().catch(() => {});
      return idleRuntime(server);
    }
    const listed = await client.listTools();
    if (gen !== generation) {
      await client.close().catch(() => {});
      return idleRuntime(server);
    }
    const definitions = definitionsFrom(listed);
    const tools = summariesFrom(definitions);
    sessions.set(server.name, { client, signature: signature(server), tools, definitions });
    client.onNotification('notifications/tools/list_changed', () => {
      void reloadServerTools(server.name, client).catch(() => {});
    });
    return { name: server.name, status: 'connected', tools };
  } catch (error) {
    await client.close().catch(() => {});
    if (gen !== generation) return idleRuntime(server);
    if (isAuthRequired(error)) return { name: server.name, status: 'auth', tools: [] };
    return { name: server.name, status: 'error', detail: errorDetail(error), tools: [] };
  }
}

let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * 只在侧栏页面调用。失败的服务器留在自己的状态里，不抛到聊天。
 * 这里不向 Agent 注册工具。同步串行执行，避免后一次连接被前一次写丢。
 */
export function syncMcpSessions(
  servers: McpServerRecord[],
  fetchImpl: McpFetch = getServiceFetch()
) {
  return enqueue(() => runSync(servers, fetchImpl));
}

async function runSync(servers: McpServerRecord[], fetchImpl: McpFetch) {
  const gen = ++generation;
  const next = new Map<string, Session>();
  await Promise.all(
    [...sessions.entries()].map(async ([name, session]) => {
      const server = servers.find((item) => item.name === name);
      if (server?.enabled && signature(server) === session.signature) {
        next.set(name, session);
        return;
      }
      await session.client.close().catch(() => {});
    })
  );
  if (gen !== generation) return;
  sessions = next;

  snapshot = servers.map((server) => {
    const existing = sessions.get(server.name);
    if (existing) return { name: server.name, status: 'connected' as const, tools: existing.tools };
    if (!server.enabled) return idleRuntime(server);
    return { name: server.name, status: 'connecting' as const, tools: [] };
  });
  emit();

  const results = await Promise.all(
    servers.map(async (server) => {
      const existing = sessions.get(server.name);
      if (existing)
        return { name: server.name, status: 'connected' as const, tools: existing.tools };
      try {
        return await connectServer(server, fetchImpl, gen);
      } catch (error) {
        return {
          name: server.name,
          status: 'error' as const,
          detail: errorDetail(error),
          tools: [],
        };
      }
    })
  );
  if (gen !== generation) return;
  snapshot = results;
  emit();
}

export function closeMcpSessions() {
  return enqueue(async () => {
    generation += 1;
    const current = [...sessions.values()];
    sessions = new Map();
    snapshot = [];
    emit();
    await Promise.all(current.map((session) => session.client.close().catch(() => {})));
  });
}
