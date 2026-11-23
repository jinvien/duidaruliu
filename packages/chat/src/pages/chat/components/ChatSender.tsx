import { FC, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Sender, Suggestion } from '@ant-design/x';
import { App as AntdApp, Flex, Alert, Button, Tooltip } from 'antd';
import {
  ArrowUpOutlined,
  BulbOutlined,
  CloseOutlined,
  FileTextOutlined,
  LoadingOutlined,
  MessageOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { agentIsStreaming, getAgentActivity, subscribeAgentActivity } from '../../../agent/runtime';
import { useAppSelector, useAppDispatch } from '../../../hooks/useStore';
import { getMcpRuntime, subscribeMcpRuntime } from '../../../mcp/session';
import { explainChatTools, modelToolCapability } from '../../../mcp/toolGate';
import { composerCanSend, composerStopVisible } from '../composer';
import { modelHasTools, modelToolsMark } from '../../../utils/modelCapability';
import store from '../../../store';
import { setIsViewHistoryMode } from '../../../store/historySlice';
import { addMessage } from '../../../store/chatSlice';
import { discardPage, loadPageRef } from '../../../store/pageSlice';
import { getChatHost } from '../../../host';
import { selectContextLimit } from '../../../page/contextLimit';
import { useChat } from '../../../hooks/useChat';
import { ChatImageError, MAX_CHAT_IMAGES, fileToChatImage } from '../../../utils/chatImage';
import { modelCapabilityMark, modelHasVision } from '../../../utils/modelCapability';
import {
  selectBackendReady,
  selectCombinedModels,
  selectSelectedModelKey,
} from '../../../models/selection';

import ToolApprovalCard from './ToolApproval';
import PageRefCard, { type PageChip } from './PageRefCard';

import Styles from '../index.module.less';

import type { ChatImage, Message } from '../../../store/chatSlice';

type PendingImage = ChatImage & { id: string };

const ChatSender: FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const modelsStatus = useAppSelector((state) => state.ollama.modelsStatus);
  // 选中自定义模型时不依赖本机 Ollama，能力来自模型自己的声明。
  const backendReady = useAppSelector(selectBackendReady);
  const allModels = useAppSelector(selectCombinedModels);
  const selectedKey = useAppSelector(selectSelectedModelKey);
  const { responseStatus } = useAppSelector((state) => state.chat);
  const toolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const mcpServers = useAppSelector((state) => state.mcp.servers);
  const mcpRuntime = useSyncExternalStore(subscribeMcpRuntime, getMcpRuntime, getMcpRuntime);
  const prompts = useAppSelector((state) => state.prompt).map((prompt) => ({
    ...prompt,
    icon: prompt.type === 'quick' ? <BulbOutlined /> : <MessageOutlined />,
  }));

  const page = useAppSelector((state) => state.page);
  const contextLimit = useAppSelector(selectContextLimit);
  const canCapturePage = Boolean(getChatHost().capturePage);

  const [userContent, setUserContent] = useState<string>('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [selectedSystemPrompt, setSelectedSystemPrompt] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visionEnabledRef = useRef(false);

  const { sendMessage, abortControl } = useChat();
  useSyncExternalStore(subscribeAgentActivity, getAgentActivity, getAgentActivity);
  const capabilityMark = modelCapabilityMark(
    allModels,
    selectedKey,
    modelsStatus === 'idle' ? 'loading' : modelsStatus
  );
  const visionEnabled = backendReady && modelHasVision(allModels, selectedKey);
  const showAttach =
    backendReady &&
    (visionEnabled || capabilityMark === 'pending' || capabilityMark === 'unknown');
  visionEnabledRef.current = visionEnabled;

  useEffect(() => {
    if (!visionEnabled) setPendingImages([]);
  }, [visionEnabled]);

  const addImageFiles = useCallback(
    async (fileList: File[]) => {
      if (!visionEnabledRef.current || !fileList.length) return;
      const room = MAX_CHAT_IMAGES - pendingImages.length;
      if (room <= 0) {
        antdMessage.warning(t('chat.imageLimit', { count: MAX_CHAT_IMAGES }));
        return;
      }
      const files = fileList.slice(0, room);
      if (fileList.length > room) {
        antdMessage.warning(t('chat.imageLimit', { count: MAX_CHAT_IMAGES }));
      }

      const next: PendingImage[] = [];
      for (const file of files) {
        try {
          const image = await fileToChatImage(file);
          next.push({ ...image, id: crypto.randomUUID() });
        } catch (error) {
          const reason = error instanceof ChatImageError ? error.reason : 'readFailed';
          const key =
            reason === 'tooLarge'
              ? 'chat.imageTooLarge'
              : reason === 'unsupported'
                ? 'chat.imageUnsupported'
                : 'chat.imageReadFailed';
          antdMessage.error(t(key));
        }
      }
      if (!next.length || !visionEnabledRef.current) return;
      setPendingImages((current) => [...current, ...next].slice(0, MAX_CHAT_IMAGES));
    },
    [antdMessage, pendingImages.length, t]
  );

  const streaming = agentIsStreaming();
  const stopVisible = composerStopVisible(responseStatus);
  const turnBusy = stopVisible || streaming;

  // content 默认取输入框。页面卡片上的快捷选项传入自己的指令，不动输入框里已有的文字。
  const handleSubmit = useCallback(
    (content: string = userContent) => {
      const status = store.getState().chat.responseStatus;
      if (!composerCanSend(status, agentIsStreaming(), content.length > 0, backendReady)) {
        return;
      }

      const images: ChatImage[] | undefined =
        visionEnabled && pendingImages.length
          ? pendingImages.map(({ dataUrl }) => ({ dataUrl }))
          : undefined;
      const pageRef = store.getState().page.ref;

      dispatch(setIsViewHistoryMode(false));
      if (content === userContent) setUserContent('');
      setPendingImages([]);
      setSelectedSystemPrompt(null);
      discardPage(dispatch);

      if (selectedSystemPrompt) {
        dispatch(
          addMessage({ role: 'system', content: selectedSystemPrompt.value, createdAt: Date.now() })
        );
      }
      const userMessage: Message = {
        role: 'user',
        content,
        createdAt: Date.now(),
      };
      if (images?.length) userMessage.images = images;
      if (pageRef) userMessage.page = pageRef;
      dispatch(addMessage(userMessage));
      sendMessage();
    },
    [
      dispatch,
      backendReady,
      pendingImages,
      selectedSystemPrompt,
      sendMessage,
      userContent,
      visionEnabled,
    ]
  );

  // 快捷选项：内置几个，再追加用户自己的快捷提示词。
  const pageChips: PageChip[] = [
    { key: 'summary', label: t('chat.page.chipSummary'), text: t('chat.page.chipSummaryPrompt') },
    { key: 'points', label: t('chat.page.chipPoints'), text: t('chat.page.chipPointsPrompt') },
    {
      key: 'translate',
      label: t('chat.page.chipTranslate'),
      text: t('chat.page.chipTranslatePrompt'),
    },
    ...prompts
      .filter((prompt) => prompt.type === 'quick')
      .map((prompt, index) => ({
        key: `quick-${index}`,
        label: prompt.label,
        text: prompt.value,
      })),
  ];

  const pageErrorText =
    page.status === 'error'
      ? t(page.error === 'unsupported' ? 'chat.page.unsupported' : 'chat.page.failed')
      : '';

  const imageLimitReached = pendingImages.length >= MAX_CHAT_IMAGES;
  const attachTitle = !visionEnabled
    ? t(capabilityMark === 'unknown' ? 'chat.visionUnknown' : 'chat.visionChecking')
    : imageLimitReached
      ? t('chat.imageLimit', { count: MAX_CHAT_IMAGES })
      : t('chat.attachImage');

  return (
    <Flex vertical gap="small">
      {selectedSystemPrompt && (
        <Alert
          message={
            <Flex
              gap="small"
              align="center"
              style={{ fontSize: 'var(--ant-font-size)', fontWeight: 'bold' }}
            >
              <MessageOutlined /> {selectedSystemPrompt.label}
            </Flex>
          }
          description={selectedSystemPrompt.value}
          type="info"
          closable={{
            'aria-label': 'close',
            closeIcon: <CloseOutlined />,
          }}
          onClose={() => setSelectedSystemPrompt(null)}
        />
      )}

      {page.status === 'loading' && (
        <Alert type="info" showIcon icon={<LoadingOutlined />} message={t('chat.page.loading')} />
      )}
      {pageErrorText && (
        <Alert
          type="warning"
          showIcon
          message={pageErrorText}
          closable={{ 'aria-label': 'close', closeIcon: <CloseOutlined /> }}
          onClose={() => discardPage(dispatch)}
        />
      )}
      {page.ref && (
        <PageRefCard
          page={page.ref}
          chips={pageChips}
          contextLimit={contextLimit}
          disabled={!composerCanSend(responseStatus, streaming, true, backendReady)}
          onRemove={() => discardPage(dispatch)}
          onChip={(text) => handleSubmit(text)}
        />
      )}

      {visionEnabled && pendingImages.length > 0 && (
        <div className={Styles.pendingImages}>
          {pendingImages.map((image) => (
            <div key={image.id} className={Styles.pendingImage}>
              <img src={image.dataUrl} alt="" />
              <button
                type="button"
                className={Styles.pendingImageRemove}
                aria-label={t('chat.removeImage')}
                onClick={() =>
                  setPendingImages((current) => current.filter((item) => item.id !== image.id))
                }
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void addImageFiles(files);
        }}
      />

      <ToolAvailabilityNotice
        notice={explainChatTools({
          toolsEnabled,
          enabledServerCount: mcpServers.filter((server) => server.enabled).length,
          connectedToolCount: mcpRuntime.reduce(
            (count, server) =>
              server.status === 'connected' ? count + server.tools.length : count,
            0
          ),
          capability: modelToolCapability({
            hasTools: modelHasTools(allModels, selectedKey),
            mark: modelToolsMark(
              allModels,
              selectedKey,
              modelsStatus === 'idle' ? 'loading' : modelsStatus
            ),
          }),
        })}
      />
      <ToolApprovalCard />
      <Suggestion
        items={prompts}
        onSelect={(prompt) => {
          // 判断的是否为系统提示词
          const item = prompts.find((item) => item.value === prompt);
          if (item?.type === 'system') {
            setSelectedSystemPrompt(item);
            setUserContent('');
          } else {
            setUserContent(prompt);
          }
        }}
      >
        {({ onTrigger, onKeyDown, open }) => {
          return (
            <Sender
              loading={stopVisible}
              submitType="enter"
              value={userContent}
              prefix={
                showAttach || canCapturePage ? (
                  <Flex gap="small">
                    {canCapturePage ? (
                      <Tooltip title={t('chat.page.attach')}>
                        <Button
                          variant="text"
                          color="default"
                          aria-label={t('chat.page.attach')}
                          icon={<FileTextOutlined />}
                          loading={page.status === 'loading'}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => void loadPageRef(dispatch)}
                        />
                      </Tooltip>
                    ) : null}
                    {showAttach ? (
                      <Tooltip title={attachTitle}>
                        <Button
                          variant="text"
                          color="default"
                          aria-label={attachTitle}
                          icon={<PictureOutlined />}
                          disabled={!visionEnabled || imageLimitReached || turnBusy}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => fileInputRef.current?.click()}
                        />
                      </Tooltip>
                    ) : null}
                  </Flex>
                ) : undefined
              }
              onPaste={(event) => {
                if (!visionEnabled || turnBusy) return;
                const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
                  file.type.startsWith('image/')
                );
                if (!files.length) return;
                const text = event.clipboardData?.getData('text') ?? '';
                if (!text) event.preventDefault();
                void addImageFiles(files);
              }}
              onChange={(nextVal) => {
                if (nextVal === '/' && prompts.length) {
                  onTrigger();
                } else if (!nextVal) {
                  onTrigger(false);
                }

                setUserContent(nextVal);
              }}
              onKeyDown={(event) => {
                const result = onKeyDown(event);
                // X 2 去掉了建议列表里回车直接选中的回调，只返回 false 来拦住发送。
                // 回车时点当前高亮项，仍走 Suggestion 自己的 onSelect。
                if (open && event.key === 'Enter') {
                  const active = document.querySelector<HTMLElement>(
                    '.ant-cascader-dropdown.ant-suggestion .ant-cascader-menu-item-active'
                  );
                  active?.click();
                  return false;
                }
                return result;
              }}
              onSubmit={() => handleSubmit()}
              onCancel={() => abortControl()}
              suffix={(_, info) => {
                const { SendButton, LoadingButton } = info.components;
                return (
                  <>
                    {stopVisible ? (
                      <LoadingButton
                        type="default"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => abortControl()}
                      />
                    ) : (
                      <SendButton
                        color="primary"
                        variant="solid"
                        icon={<ArrowUpOutlined />}
                        shape="default"
                        type="default"
                        disabled={
                          !composerCanSend(
                            responseStatus,
                            agentIsStreaming(),
                            userContent.length > 0,
                            backendReady
                          )
                        }
                      />
                    )}
                  </>
                );
              }}
            />
          );
        }}
      </Suggestion>
    </Flex>
  );
};

function ToolAvailabilityNotice({ notice }: { notice: ReturnType<typeof explainChatTools> }) {
  const { t } = useTranslation();
  if (notice.kind === 'hidden' || notice.kind === 'active') return null;
  return (
    <Alert
      type="warning"
      showIcon
      message={t(`chat.toolsGate.${notice.kind}`)}
      style={{ marginBottom: 8 }}
    />
  );
}

export default ChatSender;
