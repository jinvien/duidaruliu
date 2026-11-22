import { FC, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Sender, Suggestion } from '@ant-design/x';
import { App as AntdApp, Flex, Alert, Button, Tooltip } from 'antd';
import { EnterIcon, Filter2Icon, Filter3Icon, CloseIcon, ImageAddIcon } from 'tdesign-icons-react';
import { useTranslation } from 'react-i18next';
import { agentIsStreaming } from '@/agent/runtime';
import { useAppSelector, useAppDispatch } from '@/hooks/useStore';
import { getMcpRuntime, subscribeMcpRuntime } from '@/mcp/session';
import { explainChatTools, modelToolCapability } from '@/mcp/toolGate';
import { composerCanSend } from '@/pages/chat/composer';
import { modelHasTools, modelToolsMark } from '@/utils/modelCapability';
import store from '@/store';
import { setIsViewHistoryMode } from '@/store/historySlice';
import { addMessage } from '@/store/chatSlice';
import { useChat } from '@/hooks/useChat';
import { ChatImageError, MAX_CHAT_IMAGES, fileToChatImage } from '@/utils/chatImage';
import { modelCapabilityMark, modelHasVision } from '@/utils/modelCapability';

import ToolApprovalCard from './ToolApproval';

import Styles from '../index.module.less';

import type { ChatImage, Message } from '@/store/chatSlice';

type PendingImage = ChatImage & { id: string };

const ChatSender: FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { ollamaIsRunning, ollamaModelParams, listedModels, modelsStatus } = useAppSelector(
    (state) => state.ollama
  );
  const { responseStatus } = useAppSelector((state) => state.chat);
  const toolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const mcpServers = useAppSelector((state) => state.mcp.servers);
  const mcpRuntime = useSyncExternalStore(subscribeMcpRuntime, getMcpRuntime, getMcpRuntime);
  const prompts = useAppSelector((state) => state.prompt).map((prompt) => ({
    ...prompt,
    icon: prompt.type === 'quick' ? <Filter2Icon /> : <Filter3Icon />,
  }));

  const [userContent, setUserContent] = useState<string>('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [selectedSystemPrompt, setSelectedSystemPrompt] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visionEnabledRef = useRef(false);

  const { sendMessage, abortControl } = useChat();
  const capabilityMark = modelCapabilityMark(
    listedModels,
    ollamaModelParams.model,
    modelsStatus === 'idle' ? 'loading' : modelsStatus
  );
  const visionEnabled = ollamaIsRunning && modelHasVision(listedModels, ollamaModelParams.model);
  const showAttach =
    ollamaIsRunning &&
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

  const turnBusy = responseStatus !== 'end' || agentIsStreaming();

  const handleSubmit = useCallback(() => {
    const status = store.getState().chat.responseStatus;
    if (!composerCanSend(status, agentIsStreaming(), userContent.length > 0, ollamaIsRunning)) {
      return;
    }

    const images: ChatImage[] | undefined =
      visionEnabled && pendingImages.length
        ? pendingImages.map(({ dataUrl }) => ({ dataUrl }))
        : undefined;

    dispatch(setIsViewHistoryMode(false));
    setUserContent('');
    setPendingImages([]);
    setSelectedSystemPrompt(null);

    if (selectedSystemPrompt) {
      dispatch(
        addMessage({ role: 'system', content: selectedSystemPrompt.value, createdAt: Date.now() })
      );
    }
    const userMessage: Message = {
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
    };
    if (images?.length) userMessage.images = images;
    dispatch(addMessage(userMessage));
    sendMessage();
  }, [
    dispatch,
    ollamaIsRunning,
    pendingImages,
    selectedSystemPrompt,
    sendMessage,
    userContent,
    visionEnabled,
  ]);

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
              <Filter3Icon /> {selectedSystemPrompt.label}
            </Flex>
          }
          description={selectedSystemPrompt.value}
          type="info"
          closable={{
            'aria-label': 'close',
            closeIcon: <CloseIcon fontSize="16" />,
          }}
          onClose={() => setSelectedSystemPrompt(null)}
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
                <CloseIcon fontSize={12} />
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
            hasTools: modelHasTools(listedModels, ollamaModelParams.model),
            mark: modelToolsMark(
              listedModels,
              ollamaModelParams.model,
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
              loading={responseStatus === 'outputting' || responseStatus === 'tool'}
              submitType="enter"
              value={userContent}
              prefix={
                showAttach ? (
                  <Tooltip title={attachTitle}>
                    <Button
                      variant="text"
                      color="default"
                      aria-label={attachTitle}
                      icon={<ImageAddIcon />}
                      disabled={!visionEnabled || imageLimitReached || turnBusy}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => fileInputRef.current?.click()}
                    />
                  </Tooltip>
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
                    {turnBusy ? (
                      <LoadingButton type="default" />
                    ) : (
                      <SendButton
                        color="primary"
                        variant="solid"
                        icon={<EnterIcon style={{ fontSize: 16 }} />}
                        shape="default"
                        type="default"
                        disabled={
                          !composerCanSend(
                            responseStatus,
                            agentIsStreaming(),
                            userContent.length > 0,
                            ollamaIsRunning
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
  if (notice.kind === 'hidden') return null;
  const message =
    notice.kind === 'active'
      ? t('chat.toolsActive', { count: notice.count })
      : t(`chat.toolsGate.${notice.kind}`);
  return (
    <Alert
      type={notice.kind === 'active' ? 'info' : 'warning'}
      showIcon
      message={message}
      style={{ marginBottom: 8 }}
    />
  );
}

export default ChatSender;
