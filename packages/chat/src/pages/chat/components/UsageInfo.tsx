import React from 'react';
import { Popover } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import {
  formatMessageTime,
  formatPercent,
  formatTokenCount,
  summarizeUsage,
} from '../../../utils/usage';

import Styles from '../index.module.less';

import type { MessageUsage } from '../../../store/chatSlice';

/**
 * 助手回答下方的用量：累计消耗和回答时间，悬停看输入、缓存命中、输出、上下文占用。
 * 没有用量（旧历史、服务不返回统计）时只显示时间。
 */
const UsageInfo: React.FC<{ usages: MessageUsage[]; createdAt: number }> = ({
  usages,
  createdAt,
}) => {
  const { t, i18n } = useTranslation();
  const summary = summarizeUsage(usages);
  const time = createdAt ? formatMessageTime(createdAt, i18n.language) : '';
  if (!summary && !time) return null;

  const rows: Array<[string, string]> = summary
    ? [
        [t('chat.usage.input'), formatTokenCount(summary.input)],
        [t('chat.usage.cached'), formatTokenCount(summary.cached)],
        [
          t('chat.usage.hitRate'),
          summary.hitRate === null ? '-' : formatPercent(summary.hitRate),
        ],
        [t('chat.usage.output'), formatTokenCount(summary.output)],
        [t('chat.usage.total'), formatTokenCount(summary.total)],
        [
          t('chat.usage.context'),
          summary.contextLimit
            ? `${formatTokenCount(summary.context)} / ${formatTokenCount(summary.contextLimit)}` +
              (summary.contextRatio === null ? '' : ` (${formatPercent(summary.contextRatio)})`)
            : formatTokenCount(summary.context),
        ],
        ...(summary.calls > 1
          ? ([[t('chat.usage.calls'), String(summary.calls)]] as Array<[string, string]>)
          : []),
      ]
    : [];

  return (
    <div className={Styles.usageInfo}>
      {summary ? (
        <Popover
          placement="topLeft"
          title={t('chat.usage.detail')}
          content={
            <dl className={Styles.usageDetail}>
              {rows.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          }
        >
          <span className={Styles.usageTrigger}>
            <DatabaseOutlined />
            <span>
              {t('chat.usage.label')} {formatTokenCount(summary.total)} {t('chat.usage.unit')}
            </span>
          </span>
        </Popover>
      ) : null}
      {time ? <span>{time}</span> : null}
    </div>
  );
};

export default UsageInfo;
