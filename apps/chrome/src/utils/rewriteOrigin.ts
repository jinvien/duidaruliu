/**
 * 重写 origin
 * @param url
 * @param options
 */
import { browser } from 'wxt/browser';

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
