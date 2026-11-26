import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { MessageUsage } from '../store/chatSlice';

export type UsageSummary = {
  /** 输入总量，包含命中缓存的部分。多次模型调用（工具循环）累加。 */
  input: number;
  output: number;
  cached: number;
  /** 本回答累计消耗。 */
  total: number;
  /** 缓存命中率，0 到 1。没有输入时为 null。 */
  hitRate: number | null;
  /** 最后一次模型调用占用的上下文：输入加输出，下一轮会原样带上。 */
  context: number;
  contextLimit: number | null;
  /** 上下文占用比例，可能超过 1。没有上限时为 null。 */
  contextRatio: number | null;
  /** 一个回答里模型被调用的次数。 */
  calls: number;
};

/**
 * 从流式收尾的消息里取用量。pi 的 input 不含缓存，这里统一成「输入总量 + 其中命中缓存」。
 * 一个 token 都没有（失败、中止、上游不返回统计）时返回 undefined，界面就不显示。
 */
export function usageFromAssistant(
  usage: AssistantMessage['usage'] | undefined,
  contextLimit: number | null
): MessageUsage | undefined {
  if (!usage) return undefined;
  const cached = usage.cacheRead || 0;
  const input = (usage.input || 0) + cached + (usage.cacheWrite || 0);
  const output = usage.output || 0;
  if (input + output <= 0) return undefined;
  return {
    input,
    output,
    cached,
    total: usage.totalTokens > 0 ? usage.totalTokens : input + output,
    ...(contextLimit ? { contextLimit } : {}),
  };
}

export function summarizeUsage(list: readonly MessageUsage[]): UsageSummary | null {
  if (!list.length) return null;
  let input = 0;
  let output = 0;
  let cached = 0;
  let total = 0;
  for (const item of list) {
    input += item.input;
    output += item.output;
    cached += item.cached;
    total += item.total;
  }
  const last = list[list.length - 1];
  const context = last.input + last.output;
  const contextLimit = last.contextLimit ?? null;
  return {
    input,
    output,
    cached,
    total,
    hitRate: input > 0 ? Math.min(1, cached / input) : null,
    context,
    contextLimit,
    contextRatio: contextLimit ? context / contextLimit : null,
    calls: list.length,
  };
}

/** 3.7M、12.3K、856。 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (value >= 10_000) return `${trimZero(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

export function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  if (percent > 0 && percent < 0.1) return '<0.1%';
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1).replace(/\.0$/, '')}%`;
}

/** 11月24日 23:44 / Nov 24, 23:44。不是今年再带上年份。 */
export function formatMessageTime(timestamp: number, lang: string, now = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const zh = lang.toLowerCase().startsWith('zh');
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    month: zh ? 'long' : 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
