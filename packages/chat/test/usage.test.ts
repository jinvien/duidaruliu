/// <reference lib="dom" />
import { customPiModel, streamCustomChat } from '../src/agent/customStream';
import { groupChatBlocks } from '../src/utils/chatView';
import { normalizeStoredMessage } from '../src/utils/chatImage';
import {
  formatMessageTime,
  formatPercent,
  formatTokenCount,
  summarizeUsage,
  usageFromAssistant,
} from '../src/utils/usage';

import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import type { CustomModel, CustomProtocol } from '../src/models/customModel';
import type { MessageUsage } from '../src/store/chatSlice';

let failed = 0;

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed += 1;
    console.error(
      `FAIL ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function sse(frames: unknown[]): ReadableStream<Uint8Array> {
  const text = frames
    .map((data) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function model(protocol: CustomProtocol): CustomModel {
  return {
    id: 's1::model-a',
    serviceId: 's1',
    url: 'https://gateway.example.com/openapi/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'model-a',
    tools: false,
    vision: false,
    thinking: false,
    customProtocol: true,
    protocol,
    sessionHeaders: false,
    contextWindows: [],
  };
}

async function usageOf(protocol: CustomProtocol, frames: unknown[]) {
  let body: Record<string, any> = {};
  const custom = model(protocol);
  const stream = streamCustomChat(
    customPiModel(custom),
    { messages: [{ role: 'user', content: 'hi', timestamp: 1 } as Message] },
    {},
    {
      model: custom,
      includeImages: false,
      includeTools: false,
      lang: 'zh-CN',
      translateSystemPrompt: '',
      translatePostfix: '',
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body ?? '{}'));
        return new Response(sse(frames), { status: 200 });
      },
    }
  );
  let message: AssistantMessage | undefined;
  for await (const event of stream) {
    if (event.type === 'done') message = event.message;
  }
  return { usage: usageFromAssistant(message?.usage, 1024), body };
}

async function protocols() {
  {
    const { usage, body } = await usageOf('chat_completions', [
      { choices: [{ delta: { role: 'assistant', content: '你好' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 2167,
          completion_tokens: 236,
          total_tokens: 2403,
          prompt_tokens_details: { cached_tokens: 576 },
        },
      },
      '[DONE]',
    ]);
    equal(body.stream_options, { include_usage: true }, 'chat completions asks for usage');
    equal(
      usage,
      { input: 2167, output: 236, cached: 576, total: 2403, contextLimit: 1024 },
      'chat completions usage'
    );
  }
  {
    const { usage } = await usageOf('responses', [
      { type: 'response.output_text.delta', delta: '好' },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 2167,
            output_tokens: 236,
            total_tokens: 2403,
            input_tokens_details: { cached_tokens: 576 },
          },
        },
      },
    ]);
    equal(
      usage,
      { input: 2167, output: 236, cached: 576, total: 2403, contextLimit: 1024 },
      'responses usage'
    );
  }
  {
    // Claude 协议的 input_tokens 不含缓存，输入总量要加回缓存读取。
    const { usage } = await usageOf('messages', [
      {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 } },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900 },
      },
      { type: 'message_stop' },
    ]);
    equal(
      usage,
      { input: 1000, output: 20, cached: 900, total: 1020, contextLimit: 1024 },
      'messages usage'
    );
  }
  {
    // 服务不返回统计时不产生用量。
    const { usage } = await usageOf('chat_completions', [
      { choices: [{ delta: { content: '好' }, finish_reason: 'stop' }] },
      '[DONE]',
    ]);
    equal(usage, undefined, 'no usage when the service sends none');
  }
}

function helpers() {
  const a: MessageUsage = { input: 1000, output: 100, cached: 500, total: 1100, contextLimit: 4000 };
  const b: MessageUsage = { input: 1200, output: 50, cached: 1000, total: 1250, contextLimit: 4000 };
  const summary = summarizeUsage([a, b]);
  equal(summary?.input, 2200, 'inputs add up');
  equal(summary?.total, 2350, 'totals add up');
  equal(summary?.hitRate, 1500 / 2200, 'hit rate is cached over input');
  equal(summary?.context, 1250, 'context follows the last call');
  equal(summary?.contextRatio, 1250 / 4000, 'context ratio');
  equal(summary?.calls, 2, 'call count');
  equal(summarizeUsage([]), null, 'empty list has no summary');
  equal(
    summarizeUsage([{ input: 0, output: 5, cached: 0, total: 5 }])?.hitRate,
    null,
    'no input means no hit rate'
  );

  equal(formatTokenCount(856), '856', 'small counts stay exact');
  equal(formatTokenCount(12_345), '12.3K', 'thousands');
  equal(formatTokenCount(3_700_000), '3.7M', 'millions');
  equal(formatTokenCount(10_000), '10K', 'trailing zero is trimmed');
  equal(formatPercent(0.4567), '46%', 'percent rounds above 10');
  equal(formatPercent(0.0456), '4.6%', 'percent keeps one decimal below 10');
  equal(formatPercent(0), '0%', 'zero percent');

  const at = new Date(2026, 10, 24, 23, 44).getTime();
  equal(formatMessageTime(at, 'zh-CN', new Date(2026, 10, 25)), '11月24日 23:44', 'zh time');
  equal(formatMessageTime(at, 'en', new Date(2026, 10, 25)).includes('23:44'), true, 'en time');

  equal(
    usageFromAssistant(
      { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, totalTokens: 0 } as AssistantMessage['usage'],
      null
    ),
    { input: 1000, output: 20, cached: 900, total: 1020 },
    'pi usage folds cache back into input'
  );
}

function storage() {
  const usage: MessageUsage = { input: 10, output: 5, cached: 4, total: 15 };
  const stored = normalizeStoredMessage({ role: 'assistant', content: 'x', createdAt: 1, usage });
  equal(stored?.usage, usage, 'usage survives a history round trip');
  equal(
    normalizeStoredMessage({ role: 'assistant', content: 'x', usage: { input: 'a' } })?.usage,
    undefined,
    'broken usage is dropped'
  );
  equal(
    normalizeStoredMessage({ role: 'assistant', content: 'x', usage: { input: 5, output: 1, cached: 99 } })
      ?.usage?.cached,
    5,
    'cached never exceeds input'
  );

  const blocks = groupChatBlocks([
    { role: 'user', content: 'q', createdAt: 1 },
    { role: 'assistant', content: 'a', createdAt: 2, usage },
    { role: 'tool', content: 't', createdAt: 3, toolName: 'x' },
    { role: 'assistant', content: 'b', createdAt: 4, usage },
  ]);
  const turn = blocks[1];
  equal(turn?.kind === 'assistant' ? turn.usages.length : -1, 2, 'a tool loop keeps each call usage');
  equal(turn?.kind === 'assistant' ? turn.createdAt : -1, 2, 'time is when the answer started');
}

async function main() {
  await protocols();
  helpers();
  storage();
  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('usage fixtures passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  throw error;
});
