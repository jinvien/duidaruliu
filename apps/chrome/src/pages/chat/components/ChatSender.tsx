import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Sender, Suggestion } from '@ant-design/x';
import { App as AntdApp, Flex, Alert, Button, Tooltip } from 'antd';
import { EnterIcon, Filter2Icon, Filter3Icon, CloseIcon, ImageAddIcon } from 'tdesign-icons-react';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '@/hooks/useStore';
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
  const prompts = useAppSelector((state) => state.prompt).map((prompt) => ({
    ...prompt,
    icon: prompt.type === 'quick' ? <Filter2Icon /> : <Filter3Icon />,
  }));

  const [userContent, setUserContent] = useState<string>('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [submitType, setSubmitType] = useState<'enter' | 'shiftEnter' | false>('enter');
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

  const handleSubmit = useCallback(() => {
    if (!userContent.length || responseStatus !== 'end' || !ollamaIsRunning) return;

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
    responseStatus,
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

          setSubmitType('enter');
        }}
      >
        {({ onTrigger, onKeyDown }) => {
          return (
            <Sender
              loading={responseStatus === 'outputting' || responseStatus === 'tool'}
              submitType={submitType}
              value={userContent}
              prefix={
                showAttach ? (
                  <Tooltip title={attachTitle}>
                    <Button
                      variant="text"
                      color="default"
                      aria-label={attachTitle}
                      icon={<ImageAddIcon />}
                      disabled={!visionEnabled || imageLimitReached || responseStatus !== 'end'}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => fileInputRef.current?.click()}
                    />
                  </Tooltip>
                ) : undefined
              }
              onPaste={(event) => {
                if (!visionEnabled || responseStatus !== 'end') return;
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
                  setSubmitType(false);
                  onTrigger();
                } else if (!nextVal) {
                  setSubmitType('enter');
                  onTrigger(false);
                }

                setUserContent(nextVal);
              }}
              onKeyDown={onKeyDown}
              onSubmit={() => handleSubmit()}
              onCancel={() => abortControl()}
              actions={(_, info) => {
                const { SendButton, LoadingButton } = info.components;
                return (
                  <>
                    {responseStatus !== 'end' ? (
                      <LoadingButton type="default" />
                    ) : (
                      <SendButton
                        color="primary"
                        variant="solid"
                        icon={<EnterIcon style={{ fontSize: 16 }} />}
                        shape="default"
                        type="default"
                        disabled={
                          !userContent.length || responseStatus !== 'end' || !ollamaIsRunning
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

export default ChatSender;
