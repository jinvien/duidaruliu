import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { prepareAssistantMarkdown } from '../../../utils/assistantMarkdown';
import { copyToClipboard } from '../../../utils/copyToClipboard';

// import styles
import Styles from '../index.module.less';

// import types
import type { GetProp, GetRef } from 'antd';
import type { ChatImage, Message } from '../../../store/chatSlice';
import type { PageRef } from '../../../page/types';

// 依赖里存在两份 @types/react，直接作为 JSX 使用会在类型检查时报错。运行时仍是原来的组件。
const Highlighter = SyntaxHighlighter as unknown as React.ComponentType<{
  language?: string;
  style?: { [key: string]: React.CSSProperties };
  children: string;
}>;

const TAIL_PIN_THRESHOLD = 16;
const OVERLAY_SCROLLBAR_WIDTH = 16;

function findScrollBox(list: GetRef<typeof Bubble.List> | null) {
  return (
    list?.scrollBoxNativeElement ??
    list?.nativeElement?.querySelector<HTMLElement>('.ant-bubble-list-scroll-box') ??
    null
  );
}

/**
 * Bubble.List 开启 autoScroll 后，视觉底部就是 scrollTop ≈ 0。
 * 另一端的 scrollTop 不能当成贴底，否则滚到旧消息也会被判断成还在底部。
 */
function isPinnedToBottom(element: HTMLElement) {
  const { scrollTop, scrollHeight, clientHeight } = element;
  const reversed = getComputedStyle(element).flexDirection === 'column-reverse';
  const distance = reversed ? Math.abs(scrollTop) : scrollHeight - clientHeight - scrollTop;
  return distance <= TAIL_PIN_THRESHOLD;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function wheelLeavesTail(event: WheelEvent) {
  return event.deltaY < 0 && Math.abs(event.deltaY) >= Math.abs(event.deltaX);
}

function keyLeavesTail(event: KeyboardEvent) {
  return (
    event.key === 'ArrowUp' ||
    event.key === 'PageUp' ||
    event.key === 'Home' ||
    (event.key === ' ' && event.shiftKey)
  );
}

/** 用视口坐标判断滚动条。offsetX/offsetY 相对的是事件目标，长气泡会把正文点击误判成拖滚动条。 */
function isScrollbarPointer(event: PointerEvent, element: HTMLElement) {
  if (event.button !== 0 || event.pointerType === 'touch') return false;
  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return false;
  const gutter = element.offsetWidth - element.clientWidth;
  if (gutter > 1) return x >= element.clientLeft + element.clientWidth;
  if (event.target !== element) return false;
  return x >= rect.width - OVERLAY_SCROLLBAR_WIDTH;
}

function lastUserCreatedAt(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index].createdAt;
  }
  return null;
}

const ChatBubbleImage: React.FC<{ src: string }> = ({ src }) => {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return <img src={src} alt="" className={Styles.userImage} onError={() => setVisible(false)} />;
};

/**
 * 长回复会每帧更新最后一条。已经写完的正文内容没变，就不能再走一遍 Markdown 解析。
 * 切换语言时，这里的 useTranslation 会自己刷新文案。
 */
const MarkdownBody = React.memo(function MarkdownBody({
  content,
  isDarkMode,
}: {
  content: string;
  isDarkMode: boolean;
}) {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const processedContent = prepareAssistantMarkdown(content);

  try {
    return (
      <ReactMarkdown
        className={Styles.messageRender}
        children={processedContent}
        rehypePlugins={[rehypeRaw]}
        remarkPlugins={[remarkGfm]}
        components={{
          table({ children }) {
            return (
              <div className={Styles.tableScroll}>
                <table>{children}</table>
              </div>
            );
          },
          // rehype-raw 会把模型输出的 think 标签交给这个自定义渲染。
          // @ts-expect-error think 不是 Markdown 的内置标签。
          think: ({ children: thought }: { children?: React.ReactNode }) => (
            <Think title={t('chat.thinkDone')} defaultExpanded={false} blink={false}>
              {thought}
            </Think>
          ),

          code({ className, children, node, style, ...rest }) {
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
});

const ChatContent: React.FC = () => {
  // tools
  const { message: antdMessage } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  // refs
  const listRef = useRef<GetRef<typeof Bubble.List>>(null);
  const followTailRef = useRef(true);
  const userScrollAtRef = useRef(0);
  const userHoldingRef = useRef(false);
  const ignoreScrollRef = useRef(0);
  const prevHeadRef = useRef<number | null>(null);
  const prevUserAtRef = useRef<number | null>(null);
  const { sendMessage } = useChat();

  // store
  const messages = useAppSelector((state) => state.chat.messages);
  const pendingTool = useAppSelector((state) => state.chat.pendingTool);
  const selectedModel = useAppSelector(selectSelectedModelLabel);
  const { responseStatus } = useAppSelector((state) => state.chat);
  const { isDarkMode } = useAppSelector((state) => state.app);
  const prevStatusRef = useRef(responseStatus);

  const scrollToTail = () => {
    ignoreScrollRef.current += 1;
    listRef.current?.scrollTo({ top: 'bottom', behavior: 'auto' });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ignoreScrollRef.current = Math.max(0, ignoreScrollRef.current - 1);
      });
    });
  };

  // 发出新消息、切换会话或重新生成时回到底部，并在回复变长时继续跟着走。
  // 用户自己离开底部后不再抢滚动，直到滚回底部或再发一条。
  // 已经贴底就不要 scrollTo：Bubble.List 会把它当成正在滚到底，短时间内内容变高都会把视口拽回去。
  useLayoutEffect(() => {
    const head = messages[0]?.createdAt ?? null;
    const userAt = lastUserCreatedAt(messages);
    const conversationChanged = head !== prevHeadRef.current;
    const userSent = userAt !== null && userAt !== prevUserAtRef.current;
    const turnStarted = prevStatusRef.current === 'end' && responseStatus !== 'end';
    if (conversationChanged || userSent || turnStarted) followTailRef.current = true;
    prevHeadRef.current = head;
    prevUserAtRef.current = userAt;
    prevStatusRef.current = responseStatus;

    if (messages.length === 0) return;
    const scheduledAt = performance.now();
    const jumpIfNeeded = () => {
      if (userHoldingRef.current || !followTailRef.current) return;
      const box = findScrollBox(listRef.current);
      if (!box || isPinnedToBottom(box)) return;
      scrollToTail();
    };
    jumpIfNeeded();
    const frame = requestAnimationFrame(() => {
      if (userScrollAtRef.current > scheduledAt) return;
      jumpIfNeeded();
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, pendingTool, responseStatus]);

  useEffect(() => {
    let box: HTMLElement | null = null;
    let detach = () => {};
    let frame = 0;
    let stopped = false;
    let observer: MutationObserver | null = null;

    const resumeIfPinned = (next: HTMLElement, mark: number) => {
      requestAnimationFrame(() => {
        if (stopped || userHoldingRef.current || userScrollAtRef.current > mark) return;
        if (isPinnedToBottom(next)) followTailRef.current = true;
      });
    };

    const bind = (next: HTMLElement) => {
      const noteUserScroll = () => {
        userScrollAtRef.current = performance.now();
      };
      const onWheel = (event: WheelEvent) => {
        if (!wheelLeavesTail(event)) return;
        const mark = performance.now();
        userScrollAtRef.current = mark;
        followTailRef.current = false;
        resumeIfPinned(next, mark);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (isTypingTarget(event.target) || !keyLeavesTail(event)) return;
        const mark = performance.now();
        userScrollAtRef.current = mark;
        followTailRef.current = false;
        resumeIfPinned(next, mark);
      };
      const onTouchStart = () => {
        userHoldingRef.current = true;
        noteUserScroll();
        followTailRef.current = false;
      };
      const onTouchEnd = () => {
        const mark = performance.now();
        userScrollAtRef.current = mark;
        userHoldingRef.current = false;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (stopped || userHoldingRef.current || userScrollAtRef.current > mark) return;
            followTailRef.current = isPinnedToBottom(next);
          });
        });
      };
      const onScroll = () => {
        if (ignoreScrollRef.current > 0) return;
        noteUserScroll();
        if (userHoldingRef.current) {
          followTailRef.current = false;
          return;
        }
        followTailRef.current = isPinnedToBottom(next);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (!isScrollbarPointer(event, next)) return;
        userHoldingRef.current = true;
        noteUserScroll();
        followTailRef.current = false;
      };
      const onPointerUp = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || !userHoldingRef.current) return;
        userHoldingRef.current = false;
        followTailRef.current = isPinnedToBottom(next);
      };
      next.addEventListener('wheel', onWheel, { passive: true });
      next.addEventListener('keydown', onKeyDown);
      next.addEventListener('touchstart', onTouchStart, { passive: true });
      next.addEventListener('touchend', onTouchEnd, { passive: true });
      next.addEventListener('touchcancel', onTouchEnd, { passive: true });
      next.addEventListener('scroll', onScroll, { passive: true });
      next.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      return () => {
        next.removeEventListener('wheel', onWheel);
        next.removeEventListener('keydown', onKeyDown);
        next.removeEventListener('touchstart', onTouchStart);
        next.removeEventListener('touchend', onTouchEnd);
        next.removeEventListener('touchcancel', onTouchEnd);
        next.removeEventListener('scroll', onScroll);
        next.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };
    };

    const sync = () => {
      const next = findScrollBox(listRef.current);
      if (next === box) return;
      detach();
      box = next;
      detach = next ? bind(next) : () => {};
    };

    let tries = 0;
    const tick = () => {
      if (stopped) return;
      const root = listRef.current?.nativeElement;
      if (root && !observer) {
        observer = new MutationObserver(sync);
        observer.observe(root, { childList: true });
      }
      sync();
      if (box) return;
      tries += 1;
      if (tries >= 180) return;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      detach();
    };
  }, []);

  const reGenerator = async () => {
    dispatch(setIsViewHistoryMode(false));
    await dispatch(
      setMessages({
        messages: dropLastAssistantTurn(messages),
      })
    );
    await sendMessage();
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
              {segment.text ? (
                <MarkdownBody content={segment.text} isDarkMode={isDarkMode} />
              ) : null}
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
