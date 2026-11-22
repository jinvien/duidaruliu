import React, { useRef, useState } from 'react';
import { App as AntdApp, Flex, Button, Space, Badge, Collapse } from 'antd';
import { Bubble } from '@ant-design/x';
import { FileCopyIcon, RefreshIcon, Filter3Icon } from 'tdesign-icons-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useTranslation } from 'react-i18next';

// import hooks
import { useAppSelector, useAppDispatch } from '../../../hooks/useStore';
import { useChat } from '../../../hooks/useChat';

// import store
import { setIsViewHistoryMode } from '../../../store/historySlice';
import { setMessages } from '../../../store/chatSlice';
import { foldAssistantText } from '../../../agent/ollamaStream';
import { dropLastAssistantTurn } from '../../../utils/chatTurn';
import { groupChatBlocks, readableToolName, type AssistantSegment } from '../../../utils/chatView';

// import utils
import { copyToClipboard } from '../../../utils/copyToClipboard';

// import styles
import Styles from '../index.module.less';

// import types
import type { GetProp, GetRef } from 'antd';
import type { ChatImage } from '../../../store/chatSlice';

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
  const selectedModel = useAppSelector((state) => state.ollama.ollamaModelParams.model);
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

  const ThinkTag = ({ children }: any) => (
    <Collapse
      bordered={false}
      items={[
        {
          key: '1',
          label: t('chat.think'),
          children: <p>{children}</p>,
        },
      ]}
      defaultActiveKey={['1']}
    />
  );

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

    let processedContent = escapeThinkContent(content);

    // 处理换行符问题，ollama deepseek 输出的 think 结束符只有一个\n的时候，无法被 rehypeRaw 准确渲染，所以正则识别下
    if (processedContent.includes('\n</think>') && !processedContent.includes('\n\n</think>')) {
      // 使用 (?<=) 后行断言确保换行符在 <think> 标签内部末尾
      processedContent = processedContent.replace(/(\n)(?=<\/think>)/g, '\n\n');
    }

    try {
      return (
        <ReactMarkdown
          className={Styles.messageRender}
          children={processedContent}
          rehypePlugins={[rehypeRaw]}
          remarkPlugins={[remarkGfm]}
          components={{
            // @ts-ignore
            think: ({ node, ...props }) => <ThinkTag {...props} />,

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
                    icon={<FileCopyIcon fill="red" />}
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

  const userContentRender = (content: string | { text: string; images?: ChatImage[] }) => {
    const text = typeof content === 'string' ? content : content.text;
    const images = typeof content === 'string' ? undefined : content.images;
    return (
      <div>
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
      <Filter3Icon style={{ marginTop: -3 }} /> {systemPrompt}
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
              const { role, content, model, images } = block.message;
              return [
                {
                  key: block.index,
                  role: role === 'system' ? 'systemMessage' : role,
                  content: role === 'system' ? renderPrompt(content) : { text: content, images },
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
            const hasVisibleText = segments.some((segment) => segment.type === 'text');
            return [
              {
                key: `assistant-${block.lastIndex}`,
                role: 'assistant' as const,
                content: (
                  <div>
                    {segments.map((segment, segmentIndex) =>
                      segment.type === 'text' ? (
                        <div key={segmentIndex}>
                          {renderMarkdown(foldAssistantText(segment.thinking ?? '', segment.text))}
                        </div>
                      ) : (
                        <Collapse
                          key={segmentIndex}
                          bordered={false}
                          style={{ marginTop: segmentIndex === 0 ? 0 : 8 }}
                          items={[
                            {
                              key: 'tool',
                              label: (
                                <span
                                  style={
                                    segment.isError
                                      ? { color: 'var(--ant-color-error)' }
                                      : undefined
                                  }
                                >
                                  {segment.pending ? <Badge status="processing" /> : null}{' '}
                                  {segment.pending
                                    ? t('chat.toolRunning', { name: segment.name })
                                    : segment.name || t('chat.toolResult')}
                                </span>
                              ),
                              children: segment.pending ? null : (
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                  {segment.content.length > 1200
                                    ? `${segment.content.slice(0, 1200)}…`
                                    : segment.content}
                                </pre>
                              ),
                            },
                          ]}
                        />
                      )
                    )}
                  </div>
                ),
                contentRender: (content: React.ReactNode) => content,
                loadingRender: () => <Badge status="processing" className="loadingDot" />,
                loading: waiting && !hasVisibleText && !pendingTool,
                header: renderHeader('assistant', block.model || selectedModel),
                footer:
                  block.copyText || (isLast && responseStatus === 'end') ? (
                    <Space>
                      {block.copyText ? (
                        <Button
                          color="default"
                          variant="text"
                          size="small"
                          icon={<FileCopyIcon />}
                          onClick={() => {
                            copyToClipboard(block.copyText);
                            antdMessage.success(t('chat.messageCopy'));
                          }}
                        />
                      ) : null}
                      {isLast && responseStatus === 'end' && (
                        <Button
                          color="default"
                          variant="text"
                          size="small"
                          icon={<RefreshIcon />}
                          onClick={() => reGenerator()}
                        />
                      )}
                    </Space>
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
