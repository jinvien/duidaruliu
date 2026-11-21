/**
 * 重写 origin
 * @param url
 * @param options
 */
import { browser } from 'wxt/browser';

import { mcpOriginRuleIds, planMcpOriginRules, planOllamaOriginRule } from '@/mcp/origin';

import type { McpServerRecord } from '@/mcp/types';

export const rewriteOrigin = async (rewriteUrl: string) => {
  try {
    const rule = planOllamaOriginRule(rewriteUrl);
    if (!rule) return;
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [rule.id],
      // @ts-ignore
      addRules: [rule],
    });
  } catch (e) {
    console.error('rewriteOrigin error:', e);
  }
};

/** 只替换 MCP 这一组规则（id >= 100）。Ollama 继续独占规则 1。 */
export async function syncMcpOriginRules(servers: McpServerRecord[]) {
  try {
    const extensionId = globalThis.chrome?.runtime?.id ?? '';
    const rules = planMcpOriginRules(servers, extensionId);
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: mcpOriginRuleIds(existing.map((rule) => rule.id)),
      // @ts-ignore
      addRules: rules,
    });
  } catch (error) {
    console.error('syncMcpOriginRules error:', error);
  }
}

/** 侧栏关闭时清掉 MCP 规则。没有扩展 id 时也不留下不限发起方的规则。 */
export async function clearMcpOriginRules() {
  await syncMcpOriginRules([]);
}
