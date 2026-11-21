/**
 * 重写 origin
 * @param url
 * @param options
 */
import { browser } from 'wxt/browser';

import { MCP_ORIGIN_RULE_ID_START, planMcpOriginRules } from '@/mcp/origin';

import type { McpServerRecord } from '@/mcp/types';

export const rewriteOrigin = async (rewriteUrl: string) => {
  try {
    const newUrl = new URL(rewriteUrl);
    const domains = [newUrl.hostname];

    const rules = [
      {
        id: 1,
        priority: 1,
        condition: {
          requestDomains: domains,
        },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            {
              header: 'Origin',
              operation: 'set',
              value: rewriteUrl,
            },
          ],
        },
      },
    ];

    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map((r) => r.id),
      // @ts-ignore
      addRules: rules,
    });
  } catch (e) {
    console.error('rewriteOrigin error:', e);
  }
};

/** 只替换 MCP 这一组规则（id >= 100）。Ollama 继续独占规则 1。 */
export async function syncMcpOriginRules(servers: McpServerRecord[]) {
  try {
    const rules = planMcpOriginRules(servers);
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
      .map((rule) => rule.id)
      .filter((id) => id >= MCP_ORIGIN_RULE_ID_START);
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      // @ts-ignore
      addRules: rules,
    });
  } catch (error) {
    console.error('syncMcpOriginRules error:', error);
  }
}
