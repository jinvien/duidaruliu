/// <reference lib="dom" />
import { streamOllamaChat } from '../src/agent/ollamaStream';
import {
  clearSessionToolAllows,
  decideToolApproval,
  isToolAllowedForSession,
  requestToolApproval,
} from '../src/mcp/approval';
import { toolRejectedReason } from '../src/mcp/tools';
import { normalizeStoredMessage } from '../src/utils/chatImage';
import { dropLastAssistantTurn } from '../src/utils/chatTurn';
import { modelHasTools, modelToolsMark } from '../src/utils/modelCapability';

import type { Api, AssistantMessageEvent, Message, Model } from '@earendil-works/pi-ai';
import type { OllamaStreamRequest } from '../src/agent/ollamaStream';

const model = {
  id: 'qwen',
  name: 'qwen',
  api: 'ollama',
  provider: 'ollama',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
} as Model<Api>;

const request = {
  url: 'http://127.0.0.1:11434/api/chat',
  modelParams: { model: 'qwen' },
  includeImages: false,
  lang: 'zh-CN',
  translateSystemPrompt: '翻译系统提示',
  translatePostfix: '请将上方内容翻译成',
} satisfies Omit<OllamaStreamRequest, 'fetchImpl' | 'includeTools'>;

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

async function collect(
  messages: Message[],
  lines: unknown[],
  includeTools = false
): Promise<{ events: AssistantMessageEvent[]; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  const stream = streamOllamaChat(model, { messages }, undefined, {
    ...request,
    includeTools,
    fetchImpl: async (_input, init) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    },
  });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, body };
}

function doneReason(events: AssistantMessageEvent[]) {
  const done = events.find((event) => event.type === 'done');
  return done?.type === 'done' ? done : undefined;
}

async function main() {
  const objectCall = await collect(
    [{ role: 'user', content: '查', timestamp: 1 }],
    [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'echo', arguments: { q: 'hi' } } }],
        },
        done: true,
        done_reason: 'stop',
      },
    ]
  );
  const objectDone = doneReason(objectCall.events);
  const objectTool = objectDone?.message.content.find((part) => part.type === 'toolCall');
  assert(objectDone?.reason === 'toolUse', 'object arguments still stop as toolUse');
  assert(objectTool?.type === 'toolCall' && objectTool.id === 'ollama-tool-1', 'stable missing id');
  assert(
    objectTool?.type === 'toolCall' && objectTool.arguments.q === 'hi',
    'object arguments are kept'
  );
  assert(!('tools' in objectCall.body), 'tools stay off without the capability flag');

  const partial = await collect(
    [{ role: 'user', content: '查', timestamp: 1 }],
    [
      {
        message: {
          content: '',
          tool_calls: [{ function: { name: 'echo', arguments: '{"q":' } }],
        },
        done: false,
      },
      {
        message: {
          content: '',
          tool_calls: [{ function: { name: 'echo', arguments: '"hi"}' } }],
        },
        done: true,
        done_reason: 'stop',
      },
    ]
  );
  const partialDone = doneReason(partial.events);
  const partialTool = partialDone?.message.content.find((part) => part.type === 'toolCall');
  assert(
    partial.events.some((event) => event.type === 'toolcall_delta'),
    'string arguments stream as deltas'
  );
  assert(partialDone?.reason === 'toolUse', 'partial JSON still ends as toolUse');
  assert(
    partialTool?.type === 'toolCall' && partialTool.arguments.q === 'hi',
    `parsed partial JSON, got ${partialTool?.type === 'toolCall' ? JSON.stringify(partialTool.arguments) : ''}`
  );

  const replay = await collect(
    [
      {
        role: 'system',
        content: '',
        timestamp: 1,
        toolsAdded: [
          {
            name: 'mcp__docs__echo',
            description: 'Echo',
            parameters: { type: 'object', properties: {} },
          },
        ],
      } as unknown as Message,
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'ollama-tool-1',
            name: 'mcp__docs__echo',
            arguments: { q: 'hi' },
          },
        ],
        api: 'ollama',
        provider: 'ollama',
        model: 'qwen',
        stopReason: 'toolUse',
        timestamp: 2,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      } as unknown as Message,
      {
        role: 'toolResult',
        toolCallId: 'ollama-tool-1',
        toolName: 'mcp__docs__echo',
        content: [
          { type: 'text', text: '好' },
          { type: 'image', data: 'aaaa', mimeType: 'image/png' },
        ],
        isError: false,
        timestamp: 3,
      } as unknown as Message,
    ],
    [{ message: { content: '完成' }, done: true, done_reason: 'stop' }],
    true
  );
  const wire = replay.body.messages as Array<Record<string, unknown>>;
  const assistant = wire.find((item) => item.role === 'assistant');
  const tool = wire.find((item) => item.role === 'tool');
  const calls = assistant?.tool_calls as Array<{
    function: { name: string; arguments: { q: string } };
  }>;
  assert(calls?.[0]?.function.name === 'mcp__docs__echo', 'assistant tool call is replayed');
  assert(calls?.[0]?.function.arguments.q === 'hi', 'tool call arguments are replayed');
  assert(tool?.tool_name === 'mcp__docs__echo', 'tool result uses tool_name');
  assert(
    String(tool?.content).includes('好') && String(tool?.content).includes('不会把它作为图像'),
    'image content becomes a sentence'
  );
  assert(
    Array.isArray(replay.body.tools) && (replay.body.tools as unknown[]).length === 1,
    'tools field is sent'
  );

  const thinkingReplay = await collect(
    [
      { role: 'user', content: '问', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '想一下' },
          { type: 'text', text: '答案' },
        ],
        api: 'ollama',
        provider: 'ollama',
        model: 'qwen',
        stopReason: 'stop',
        timestamp: 2,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      } as unknown as Message,
    ],
    [{ message: { content: '好' }, done: true, done_reason: 'stop' }]
  );
  const thought = (thinkingReplay.body.messages as Array<Record<string, unknown>>).find(
    (item) => item.role === 'assistant'
  );
  assert(thought?.content === '答案', 'thinking is not folded into content');
  assert(thought?.thinking === '想一下', 'thinking is replayed on its own field');
  assert(!String(thought?.content).includes('想一下'), 'content does not repeat thinking');

  const hidden = await collect(
    [{ role: 'user', content: '你好', timestamp: 1 }],
    [{ message: { content: '好' }, done: true, done_reason: 'stop' }],
    false
  );
  assert(!('tools' in hidden.body), 'missing tools capability omits the field');
  assert(
    !(hidden.body.messages as Array<{ role?: string }>).some((item) => item.role === 'system'),
    'a plain chat does not invent a system prompt'
  );

  assert(
    modelHasTools([{ name: 'qwen', capabilities: ['tools'], capabilityState: 'known' }], 'qwen'),
    'known tools'
  );
  assert(
    !modelHasTools([{ name: 'qwen', capabilities: [], capabilityState: 'known' }], 'qwen'),
    'confirmed absence'
  );
  assert(
    !modelHasTools([{ name: 'qwen', capabilities: [], capabilityState: 'pending' }], 'qwen'),
    'pending does not send tools'
  );
  assert(
    !modelHasTools([{ name: 'qwen', capabilities: ['tools'], capabilityState: 'unknown' }], 'qwen'),
    'unknown does not send tools'
  );
  assert(
    modelToolsMark(
      [{ name: 'qwen', capabilities: ['tools'], capabilityState: 'known' }],
      'qwen',
      'ready'
    ) === 'tools',
    'tools mark'
  );
  assert(
    modelToolsMark(
      [{ name: 'qwen', capabilities: [], capabilityState: 'pending' }],
      'qwen',
      'ready'
    ) === 'pending',
    'pending mark'
  );
  assert(
    modelToolsMark(
      [{ name: 'qwen', capabilities: [], capabilityState: 'unknown' }],
      'qwen',
      'error'
    ) === 'unknown',
    'unknown mark'
  );
  assert(
    modelToolsMark(
      [{ name: 'qwen', capabilities: [], capabilityState: 'known' }],
      'qwen',
      'ready'
    ) === null,
    'no tools mark when confirmed absent'
  );

  clearSessionToolAllows();
  const once = requestToolApproval(
    { id: 'mcp__docs__echo', displayName: 'echo', serverName: 'docs', args: { q: 1 } },
    new AbortController().signal
  );
  decideToolApproval('once');
  assert((await once) === 'once', 'allow once');
  assert(!isToolAllowedForSession('mcp__docs__echo'), 'allow once is not remembered');

  const session = requestToolApproval(
    { id: 'mcp__docs__echo', displayName: 'echo', serverName: 'docs', args: {} },
    new AbortController().signal
  );
  decideToolApproval('session');
  assert((await session) === 'session', 'allow for session');
  assert(isToolAllowedForSession('mcp__docs__echo'), 'session allow is remembered');

  const rejected = requestToolApproval(
    { id: 'mcp__docs__other', displayName: 'other', serverName: 'docs', args: {} },
    new AbortController().signal
  );
  decideToolApproval('reject');
  assert((await rejected) === 'reject', 'reject');
  assert(toolRejectedReason().includes('没有执行'), 'reject reason tells the model');

  const controller = new AbortController();
  const aborted = requestToolApproval(
    { id: 'mcp__docs__echo', displayName: 'echo', serverName: 'docs', args: {} },
    controller.signal
  );
  controller.abort();
  assert((await aborted) === 'aborted', 'abort ends the pending approval');

  const kept = normalizeStoredMessage({
    role: 'user',
    content: '旧问题',
    createdAt: 1,
  });
  assert(kept?.content === '旧问题' && kept.toolCalls === undefined, 'old history still loads');
  const storedTool = normalizeStoredMessage({
    role: 'assistant',
    content: '',
    createdAt: 2,
    toolCalls: [{ id: 'ollama-tool-1', name: 'echo', arguments: { q: 'hi' } }],
  });
  assert(storedTool?.toolCalls?.[0]?.arguments.q === 'hi', 'tool calls survive storage');
  const storedName = normalizeStoredMessage({
    role: 'tool',
    content: '好',
    createdAt: 3,
    toolName: 'mcp__docs__echo',
    toolDisplayName: '回声',
  });
  assert(
    storedName?.toolName === 'mcp__docs__echo' && storedName.toolDisplayName === '回声',
    'display name survives storage'
  );

  const trimmed = dropLastAssistantTurn([
    { role: 'user', content: '问', createdAt: 1 },
    {
      role: 'assistant',
      content: '',
      createdAt: 2,
      toolCalls: [{ id: 'ollama-tool-1', name: 'echo', arguments: {} }],
    },
    { role: 'tool', content: '好', createdAt: 3, toolName: 'echo', toolCallId: 'ollama-tool-1' },
    { role: 'assistant', content: '答', createdAt: 4 },
  ]);
  assert(
    trimmed.length === 1 && trimmed[0]?.role === 'user',
    'regenerate returns to the user message'
  );
  const earlier = dropLastAssistantTurn([
    { role: 'user', content: '一', createdAt: 1 },
    { role: 'assistant', content: '答一', createdAt: 2 },
    { role: 'user', content: '二', createdAt: 3 },
    { role: 'tool', content: '好', createdAt: 4, toolName: 'echo', toolCallId: 'ollama-tool-1' },
  ]);
  assert(
    earlier.length === 3 && earlier[2]?.role === 'user',
    'regenerate keeps the previous user turn'
  );

  clearSessionToolAllows();
  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('stage 3 fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
