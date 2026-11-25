import { FC, useMemo, useState } from 'react';
import { Button, Flex, Modal, Tag, Typography } from 'antd';
import { CloseOutlined, EyeOutlined, GlobalOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

import { estimateTokens } from '../../../page/tokens';

import Styles from '../index.module.less';

import type { PageRef } from '../../../page/types';

export type PageChip = { key: string; label: string; text: string };

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type Props = {
  page: PageRef;
  chips: PageChip[];
  /** 当前模型的上下文窗口，未知时不提示。 */
  contextLimit: number | null;
  disabled?: boolean;
  onRemove: () => void;
  onChip: (text: string) => void;
};

const PageRefCard: FC<Props> = ({ page, chips, contextLimit, disabled, onRemove, onChip }) => {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const tokens = useMemo(() => estimateTokens(page.content), [page.content]);
  const overflow = contextLimit != null && tokens > contextLimit;

  return (
    <Flex vertical gap="small" className={Styles.pageCard}>
      <Flex align="flex-start" gap="small">
        <GlobalOutlined className={Styles.pageCardIcon} />
        <Flex vertical flex={1} className={Styles.pageCardMain}>
          <Typography.Link
            href={page.url}
            target="_blank"
            rel="noreferrer"
            className={Styles.pageCardTitle}
          >
            {page.title}
          </Typography.Link>
          <Typography.Text type="secondary" className={Styles.pageCardMeta}>
            {hostnameOf(page.url)}
          </Typography.Text>
          {page.description ? (
            <Typography.Paragraph type="secondary" className={Styles.pageCardDesc}>
              {page.description}
            </Typography.Paragraph>
          ) : null}
        </Flex>
        <Button
          type="text"
          size="small"
          aria-label={t('chat.page.preview')}
          icon={<EyeOutlined />}
          onClick={() => setPreviewOpen(true)}
        />
        <Button
          type="text"
          size="small"
          aria-label={t('chat.page.remove')}
          icon={<CloseOutlined />}
          onClick={onRemove}
        />
      </Flex>

      <Flex wrap gap="small" align="center">
        <Tag color={overflow ? 'warning' : undefined} variant="filled" style={{ marginInlineEnd: 0 }}>
          {t('chat.page.tokens', { count: tokens })}
        </Tag>
        {page.truncated ? <Tag color="warning">{t('chat.page.truncated')}</Tag> : null}
        {overflow ? (
          <Typography.Text type="warning" className={Styles.pageCardMeta}>
            {t('chat.page.overContext', { limit: contextLimit })}
          </Typography.Text>
        ) : null}
      </Flex>

      {chips.length ? (
        <Flex wrap gap="small">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              size="small"
              shape="round"
              disabled={disabled}
              onClick={() => onChip(chip.text)}
            >
              {chip.label}
            </Button>
          ))}
        </Flex>
      ) : null}

      <Modal
        open={previewOpen}
        title={t('chat.page.previewTitle')}
        footer={null}
        width="90%"
        onCancel={() => setPreviewOpen(false)}
        destroyOnHidden
      >
        <div className={Styles.pagePreview}>
          {/* 页面正文是不可信内容：不启用 rehype-raw，图片只显示替代文字，避免预览时向外发请求。 */}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ alt }) => <span>{alt ? `[${alt}]` : ''}</span>,
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
            }}
          >
            {page.content}
          </ReactMarkdown>
        </div>
      </Modal>
    </Flex>
  );
};

export default PageRefCard;
