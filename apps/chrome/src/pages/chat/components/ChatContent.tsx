import React, { useRef } from 'react';
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
import { useAppSelector, useAppDispatch } from '@/hooks/useStore';
import { useChat } from '@/hooks/useChat';

// import store
import { setIsViewHistoryMode } from '@/store/historySlice';
import { setMessages } from '@/store/chatSlice';

// import utils
import { copyToClipboard } from '@/utils/copyToClipboard';

// import styles
import Styles from '../index.module.less';

// import types
import type { GetProp, GetRef } from 'antd';
import type { BubbleProps } from '@ant-design/x';

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
  const { responseStatus } = useAppSelector((state) => state.chat);
  const { isDarkMode } = useAppSelector((state) => state.app);

  const reGenerator = async () => {
    dispatch(setIsViewHistoryMode(false));
    await dispatch(
      setMessages({
        messages: messages.slice(0, -1),
      })
    );
    sendMessage();
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

  const messageRender: BubbleProps['messageRender'] = (content) => {
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
                  <SyntaxHighlighter
                    language={language}
                    style={themeStyle}
                    children={childrenString}
                  />
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

  const userContentRender = (content: string) => {
    return <div className={Styles.userContentPre}>{content}</div>;
  };

  const roles: GetProp<typeof Bubble.List, 'roles'> = {
    system: {
      variant: 'outlined',
    },
    assistant: {
      placement: 'start',
      shape: 'corner',
      variant: 'outlined',
      messageRender,
    },
    user: {
      placement: 'end',
      shape: 'corner',
      messageRender: userContentRender,
    },
  };

  const renderPrompt = (systemPrompt: string) => (
    <>
      <Filter3Icon style={{ marginTop: -3 }} /> {systemPrompt}
    </>
  );

  const renderHeader = (role: keyof typeof roles, model: string | undefined) => {
    if (role === 'assistant') {
      return <strong>{model}</strong>;
    }
    if (role === 'system') {
      return <strong>system</strong>;
    }
  };

  return (
    <Flex gap="middle" vertical style={{ height: '100%' }}>
      <Bubble.List
        className={Styles.bubbleList}
        ref={listRef}
        style={{ maxHeight: '100%' }}
        roles={roles}
        items={messages.map(({ role, content, model }, i) => {
          return {
            key: i,
            role,
            content: role === 'system' ? renderPrompt(content) : content,
            loadingRender: () => <Badge status="processing" className="loadingDot" />,
            loading: i === messages.length - 1 && responseStatus === 'waiting',
            header: role === 'user' ? null : renderHeader(role, model),
            footer:
              role === 'assistant' ? (
                <Space>
                  <Button
                    color="default"
                    variant="text"
                    size="small"
                    icon={<FileCopyIcon />}
                    onClick={() => {
                      copyToClipboard(content);
                      antdMessage.success(t('chat.messageCopy'));
                    }}
                  />
                  {i === messages.length - 1 && (
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
          };
        })}
      />
    </Flex>
  );
};

export default ChatContent;
