import React, { useRef, useState } from 'react';
import { App as AntdApp, Badge, Button, Flex, Typography } from 'antd';
import { Actions, Bubble, Think, ThoughtChain } from '@ant-design/x';
import { CopyOutlined, MessageOutlined, SyncOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useTranslation } from 'react-i18next';

import { hostnameOf } from './PageRefCard';

// import hooks
import { useAppSelector, useAppDispatch } from '../../../hooks/useStore';
import { useChat } from '../../../hooks/useChat';

// import store
import { setIsViewHistoryMode } from '../../../store/historySlice';
import { setMessages } from '../../../store/chatSlice';
import { selectSelectedModelLabel } from '../../../models/selection';
import { dropLastAssistantTurn } from '../../../utils/chatTurn';
import { groupChatBlocks, readableToolName, type AssistantSegment } from '../../../utils/chatView';

// import utils
import { copyToClipboard } from '../../../utils/copyToClipboard';

// import styles
import Styles from '../index.module.less';

// import types
import type { GetProp, GetRef } from 'antd';
import type { ChatImage } from '../../../store/chatSlice';
import type { PageRef } from '../../../page/types';

// 依赖里存在两份 @types/react，直接作为 JSX 使用会在类型检查时报错。运行时仍是原来的组件。
const Highlighter = SyntaxHighlighter as unknown as React.ComponentType<{
  language?: string;
  style?: { [key: string]: React.CSSProperties };
  children: string;
}>;

const ChatBubbleImage: React.FC<{ src: string }> = ({ src }) => {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return <img src={src} alt="" className={Styles.userImage} onError={() => setVisible(false)} />;
};

const ChatContent: React.FC = () => {
  // tools
  const { message: antdMessage } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  // refs
  const listRef = useRef<GetRef<typeof Bubble.List>>(null);
  const { sendMessage } = useChat();

  // store
  const messages = useAppSelector((state) => state.chat.messages);
  const pendingTool = useAppSelector((state) => state.chat.pendingTool);
  const selectedModel = useAppSelector(selectSelectedModelLabel);
  const { responseStatus } = useAppSelector((state) => state.chat);
  const { isDarkMode } = useAppSelector((state) => state.app);

  const reGenerator = async () => {
    dispatch(setIsViewHistoryMode(false));
    await dispatch(
      setMessages({
        messages: dropLastAssistantTurn(messages),
      })
    );
    await sendMessage();
  };

  const renderMarkdown = (content: string) => {
    // 预处理函数
    const escapeThinkContent = (raw: string) => {
      return (
        raw
          // 处理已闭合的 think 标签
          .replace(/<think>([\s\S]*?)<\/think>/g, (_, content) => {
            return `<think>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</think>`;
          })
          // 处理未闭合的 think 标签（流式场景）
          .replace(/<think>([\s\S]*?)(?=<think>|<\/think>|$)/g, (_, content) => {
            return `<think>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
          })
      );
    };

    const processedContent = escapeThinkContent(content);

    try {
      return (
        <ReactMarkdown
          className={Styles.messageRender}
          children={processedContent}
          rehypePlugins={[rehypeRaw]}
          remarkPlugins={[remarkGfm]}
          components={{
            // rehype-raw 会把模型输出的 think 标签交给这个自定义渲染。
            // @ts-expect-error think 不是 Markdown 的内置标签。
            think: ({ children: thought }: { children?: React.ReactNode }) => (
              <Think title={t('chat.thinkDone')} defaultExpanded={false} blink={false}>
                {thought}
              </Think>
            ),

            code({ node, className, children, style, ...rest }) {
              const match = /language-(\w+)/.exec(className || '');
              const language = className?.replace('language-', '');
              const childrenString = String(children).replace(/\n$/, '');
              const themeStyle = isDarkMode ? oneDark : oneLight;

              return match ? (
                <div className={Styles.codeBlock}>
                  <Button
                    className={Styles.codeBlockCopy}
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      copyToClipboard(childrenString);
                      antdMessage.success(t('chat.codeCopy'));
                    }}
                  />
                  <Highlighter language={language} style={themeStyle} children={childrenString} />
                </div>
              ) : (
                <code
                  {...rest}
                  className={className}
                  style={{
                    background: 'var(--ant-color-bg-layout)',
                    padding: '2px var(--ant-padding-xs) ',
                    borderRadius: '4px',
                  }}
                >
                  {children}
                </code>
              );
            },
          }}
        />
      );
    } catch {
      return t('chat.renderError');
    }
  };

  const userContentRender = (
    content: string | { text: string; images?: ChatImage[]; page?: PageRef }
  ) => {
    const text = typeof content === 'string' ? content : content.text;
    const images = typeof content === 'string' ? undefined : content.images;
    const page = typeof content === 'string' ? undefined : content.page;
    return (
      <div>
        {page ? (
          <div className={Styles.userPage}>
            <Typography.Link
              href={page.url}
              target="_blank"
              rel="noreferrer"
              ellipsis
              className={Styles.userPageTitle}
            >
              {page.title}
            </Typography.Link>
            <span className={Styles.userPageHost}>{hostnameOf(page.url)}</span>
          </div>
        ) : null}
        {images?.length ? (
          <div className={Styles.userImages}>
            {images.map((image, index) => (
              <ChatBubbleImage key={index} src={image.dataUrl} />
            ))}
          </div>
        ) : null}
        {text ? <div className={Styles.userContentPre}>{text}</div> : null}
      </div>
    );
  };

  // X 2 把 role 为 system 的项渲染成居中的 SystemBubble。系统提示仍走普通气泡，沿用原来的描边和标题。
  const roles: GetProp<typeof Bubble.List, 'role'> = {
    systemMessage: {
      variant: 'outlined',
    },
    assistant: {
      placement: 'start',
      shape: 'corner',
      variant: 'outlined',
      contentRender: (content) => (typeof content === 'string' ? renderMarkdown(content) : content),
    },
    user: {
      placement: 'end',
      shape: 'corner',
      contentRender: userContentRender,
    },
    tool: {
      placement: 'start',
      shape: 'corner',
      variant: 'borderless',
    },
  };

  const renderPrompt = (systemPrompt: string) => (
    <>
      <MessageOutlined /> {systemPrompt}
    </>
  );

  const renderHeader = (role: 'assistant' | 'system' | 'user' | 'tool', model?: string) => {
    if (role === 'assistant') {
      if (!model || model === 'unknown') return null;
      return <strong>{model}</strong>;
    }
    if (role === 'system') {
      return <strong>system</strong>;
    }
  };

  const renderAssistantBody = (segments: AssistantSegment[], thinkingLive: boolean) => (
    <div>
      {segments.map((segment, segmentIndex) => {
        if (segment.type === 'text') {
          const thinking = segment.thinking?.trim();
          return (
            <div key={segmentIndex}>
              {thinking ? (
                <Think
                  title={thinkingLive && !segment.text ? t('chat.think') : t('chat.thinkDone')}
                  loading={thinkingLive && !segment.text}
                  defaultExpanded={false}
                  blink={false}
                >
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{thinking}</p>
                </Think>
              ) : null}
              {segment.text ? renderMarkdown(segment.text) : null}
            </div>
          );
        }
        const title = segment.pending
          ? t('chat.toolRunning', { name: segment.name })
          : segment.name || t('chat.toolResult');
        return (
          <ThoughtChain
            key={segmentIndex}
            style={{ marginTop: segmentIndex === 0 ? 0 : 8 }}
            items={[
              {
                key: `tool-${segmentIndex}`,
                title,
                status: segment.pending ? 'loading' : segment.isError ? 'error' : 'success',
                collapsible: !segment.pending && segment.content.length > 0,
                content: segment.pending ? null : (
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {segment.content.length > 1200
                      ? `${segment.content.slice(0, 1200)}…`
                      : segment.content}
                  </pre>
                ),
              },
            ]}
          />
        );
      })}
    </div>
  );

  return (
    <Flex gap="middle" vertical style={{ height: '100%', minHeight: 0 }}>
      <Bubble.List
        className={Styles.bubbleList}
        ref={listRef}
        // 列表自己托管滚动，必须有确定高度；不传 streaming / typing，避免打字机改写已经流出的正文。
        style={{ height: '100%', minHeight: 0 }}
        role={roles}
        items={groupChatBlocks(messages, selectedModel).flatMap(
          (block, blockIndex, blocks): any => {
            const isLast = blockIndex === blocks.length - 1;
            if (block.kind === 'message') {
              const { role, content, model, images, page } = block.message;
              return [
                {
                  key: block.index,
                  role: role === 'system' ? 'systemMessage' : role,
                  content: role === 'system' ? renderPrompt(content) : { text: content, images, page },
                  loadingRender: () => <Badge status="processing" className="loadingDot" />,
                  loading: false,
                  header: role === 'user' ? null : renderHeader(role, model),
                  footer: null,
                },
              ];
            }
            const waiting = isLast && responseStatus === 'waiting';
            if (block.segments.length === 0 && !(pendingTool && isLast) && !waiting) return [];
            const segments: AssistantSegment[] =
              pendingTool && isLast
                ? [
                    ...block.segments,
                    {
                      type: 'tool',
                      name:
                        readableToolName(pendingTool.displayName, pendingTool.name) ||
                        t('chat.toolResult'),
                      content: '',
                      pending: true,
                    },
                  ]
                : block.segments;
            const hasVisibleText = segments.some(
              (segment) => segment.type === 'text' && (segment.text || segment.thinking)
            );
            const thinkingLive = isLast && (responseStatus === 'outputting' || responseStatus === 'waiting');
            const actions = [
              block.copyText
                ? {
                    key: 'copy',
                    icon: <CopyOutlined />,
                    label: t('chat.messageCopy'),
                  }
                : null,
              isLast && responseStatus === 'end'
                ? {
                    key: 'retry',
                    icon: <SyncOutlined />,
                    label: t('chat.regenerate'),
                  }
                : null,
            ].filter((item) => item !== null);
            return [
              {
                key: `assistant-${block.lastIndex}`,
                role: 'assistant' as const,
                content: renderAssistantBody(segments, thinkingLive),
                contentRender: (content: React.ReactNode) => content,
                loadingRender: () => <Badge status="processing" className="loadingDot" />,
                loading: waiting && !hasVisibleText && !pendingTool,
                header: renderHeader('assistant', block.model || selectedModel),
                footer: actions.length ? (
                  <Actions
                    fadeIn={false}
                    fadeInLeft={false}
                    items={actions}
                    onClick={({ key }) => {
                      if (key === 'copy') {
                        copyToClipboard(block.copyText);
                        antdMessage.success(t('chat.messageCopy'));
                      }
                      if (key === 'retry') void reGenerator();
                    }}
                  />
                ) : null,
              },
            ];
          }
        )}
      />
    </Flex>
  );
};

export default ChatContent;
