import React, { useEffect, useState } from 'react';
import { App as AntdApp, Drawer, Upload, Button, Flex, Tooltip, Divider, Tag } from 'antd';
import { Conversations as ConversationsPanel } from '@ant-design/x';
import {
  FileDownloadIcon,
  FileImportIcon,
  ModeDarkIcon,
  ModeLightIcon,
  SettingIcon,
  ChatAddIcon,
  Translate1Icon,
} from 'tdesign-icons-react';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import Links from './Links';

// store
import { loadAgentTranscript, settleAgent } from '@/agent/runtime';
import { useAppSelector, useAppDispatch } from '@/hooks/useStore';
import {
  setIsShowHistoryPanel,
  setIsViewHistoryMode,
  storeCurrentMessages,
  initializeConversations,
} from '@/store/historySlice';
import { setOllamaModelParams } from '@/store/ollamaSlice';
import { setMessages } from '@/store/chatSlice';
import { toggleTheme } from '@/store/appSlice';

// utils
import { getTimeGroup, classifyHistoryListTime } from '@/utils/date';
import { exportJsonArrayToFile, uploadHistoryMessages } from '@/utils/filesHelper';
import { queryCurrentTab } from '@/utils/tab';
import { contentWithPromptTag } from '@/utils/promptHelper';
import { answerModelName, lastAnswerModel } from '@/utils/chatView';

// import styles
import Styles from '../index.module.less';

// types
import type { GetProp } from 'antd';
import type { ConversationsProps } from '@ant-design/x';
import type { SetAppMode } from '@/entrypoints/sidepanel/App';
import type { Message } from '@/store/chatSlice';

const HistoryPanel: React.FC<{ setAppMode: SetAppMode }> = ({ setAppMode }) => {
  const { message: antdMessage } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation();

  const DATE_GROUP_MAP = {
    today: i18n.t('utils.today'),
    lastDay: i18n.t('utils.lastDay'),
    last7Day: i18n.t('utils.last7Day'),
    last30Day: i18n.t('utils.last30Day'),
    earlier: i18n.t('utils.earlier'),
  };

  const { isShowHistoryPanel, conversations, isViewHistoryMode } = useAppSelector(
    (state) => state.history
  );
  const messages = useAppSelector((state) => state.chat.messages);
  const { ollamaModelParams } = useAppSelector((state) => state.ollama);
  const { isDarkMode, lang } = useAppSelector((state) => state.app);

  const [listOpenedAt, setListOpenedAt] = useState(() => Date.now());
  const [historyPanelWasOpen, setHistoryPanelWasOpen] = useState(isShowHistoryPanel);
  if (isShowHistoryPanel !== historyPanelWasOpen) {
    setHistoryPanelWasOpen(isShowHistoryPanel);
    if (isShowHistoryPanel) setListOpenedAt(Date.now());
  }

  useEffect(() => {
    if (!isShowHistoryPanel) {
      return;
    }
    dispatch(initializeConversations());
  }, [isShowHistoryPanel]);

  const onHistoryItemChange = async (key: number) => {
    const conversation = conversations?.[key];
    if (!conversation) return;

    const viewingHistory = isViewHistoryMode;
    const currentMessages = messages;
    await settleAgent();

    if (!viewingHistory) {
      dispatch(storeCurrentMessages(currentMessages));
      dispatch(setIsViewHistoryMode(true));
    }

    const restoredModel = answerModelName(conversation.lastModel);
    if (restoredModel) {
      dispatch(setOllamaModelParams({ ...ollamaModelParams, model: restoredModel }));
    }
    dispatch(setMessages({ messages: conversation.messages }));
    loadAgentTranscript(conversation.messages);
  };

  const changeLanguage = async () => {
    const newLang = lang === 'en' ? 'zh-CN' : 'en';

    const { appSettings } = await chrome.storage.sync.get('appSettings');
    chrome.storage.sync.set({ appSettings: { ...appSettings, lang: newLang } });
  };

  const previewSource = (message?: Message) => {
    if (!message) return '';
    const text = message.content.trim();
    if (text) return text;
    if (message.images?.length) return t('chat.imageMessage');
    return '';
  };

  const formatHistoryListTime = (timestamp: number) => {
    const value = classifyHistoryListTime(timestamp, listOpenedAt);
    if (!value) return '';
    switch (value.type) {
      case 'justNow':
        return t('utils.justNow');
      case 'minutes':
        return t('utils.minutesAgo', { count: value.count });
      case 'hours':
        return t('utils.hoursAgo', { count: value.count });
      case 'yesterday':
        return `${t('utils.lastDay')} ${value.time}`;
      case 'days':
        return t('utils.daysAgo', { count: value.count });
      case 'monthDay':
      case 'full':
        return value.text;
    }
  };

  const chatHistoryItems: GetProp<ConversationsProps, 'items'> = conversations?.map(
    ({ messages: conversationMessages, lastUpdatedAt, lastModel }, i) => {
      const [firstMessage, secondMessage] = conversationMessages;
      const role = firstMessage?.role;
      const originalContent = firstMessage?.content ?? '';
      let displayedContent: string | React.ReactNode = originalContent;

      if (role === 'system') {
        const systemContent = previewSource(secondMessage);
        displayedContent = contentWithPromptTag(originalContent, systemContent);
      } else {
        displayedContent = previewSource(firstMessage);
      }

      const questionText =
        role === 'system' ? previewSource(secondMessage) : previewSource(firstMessage);
      const modelName = lastAnswerModel(conversationMessages, lastModel);
      const timeText = formatHistoryListTime(lastUpdatedAt);
      const groupKey = getTimeGroup(lastUpdatedAt);
      const label = (
        <span className={Styles.historyLabel}>
          <span className={Styles.historyLabelTitle}>{displayedContent}</span>
          {modelName || timeText ? (
            <span className={Styles.historyLabelMeta}>
              {modelName ? (
                <Tag
                  bordered={false}
                  className={Styles.historyModelTag}
                  style={{
                    marginInlineEnd: 0,
                    color: 'var(--ant-color-text-description)',
                    background: 'var(--ant-color-fill-quaternary)',
                  }}
                >
                  {modelName}
                </Tag>
              ) : null}
              {timeText ? <span className={Styles.historyLabelTime}>{timeText}</span> : null}
            </span>
          ) : null}
        </span>
      );

      return {
        key: i.toString(),
        label: questionText ? (
          <Tooltip
            title={questionText}
            placement="right"
            color="var(--ant-color-bg-elevated)"
            styles={{
              container: {
                color: 'var(--ant-color-text-description)',
                fontSize: 'var(--ant-font-size)',
                lineHeight: 'var(--ant-line-height)',
                maxWidth: 240,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              },
            }}
          >
            {label}
          </Tooltip>
        ) : (
          label
        ),
        disabled: false,
        group: DATE_GROUP_MAP[groupKey as keyof typeof DATE_GROUP_MAP] || t('utils.earlier'),
      };
    }
  );

  const renderHeader = () => {
    return (
      <>
        <Button
          variant="text"
          color="default"
          icon={<ChatAddIcon />}
          // onClick={() => createNewChat()}
        >
          {t('chat.newChat')}
        </Button>
      </>
    );
  };

  return (
    <main>
      <Drawer
        //todo 在 title 中绘制 关闭、标题、新对话入口
        // title={renderHeader()}
        placement="left"
        open={isShowHistoryPanel}
        size={260}
        closable={false}
        onClose={() => {
          dispatch(setIsShowHistoryPanel(false));
        }}
        footer={
          <section>
            <Links setAppMode={setAppMode} />
            <Divider style={{ margin: 0 }} />
            <Flex
              style={{ padding: 'var(--ant-padding-sm) var(--ant-padding-xxs)' }}
              justify="space-between"
            >
              <div>
                <Tooltip title={t('chat.openSettingPanel')}>
                  <Button
                    variant="text"
                    color="default"
                    icon={<SettingIcon />}
                    onClick={async () => {
                      const currentTabUrl = (await queryCurrentTab()).url || '';
                      const isOptionsPage =
                        /^chrome-extension:\/\/ghfkjnjclg.*\/sidepanel\.html.*$/.test(
                          currentTabUrl
                        );
                      if (isOptionsPage) {
                        return;
                      }
                      chrome.tabs.create({
                        url: chrome.runtime.getURL('sidepanel.html?appMode=setting'),
                      });
                    }}
                  />
                </Tooltip>
                <Tooltip title={t('chat.toggleTheme')}>
                  <Button
                    variant="text"
                    color="default"
                    onClick={() => dispatch(toggleTheme())}
                    icon={isDarkMode ? <ModeLightIcon /> : <ModeDarkIcon />}
                  />
                </Tooltip>
                <Tooltip title={t('chat.toggleLang')}>
                  <Button
                    variant="text"
                    color="default"
                    icon={<Translate1Icon />}
                    onClick={() => changeLanguage()}
                  />
                </Tooltip>
              </div>
              <div>
                <Upload
                  customRequest={({ file }: any) => {
                    uploadHistoryMessages({
                      file,
                      onSuccess: () => {
                        antdMessage.success(t('chat.uploadSuccess'));
                        dispatch(initializeConversations());
                      },
                      onError: () => antdMessage.error(t('chat.fileExtFailed')),
                      onValidFailed: () => antdMessage.error(t('chat.chatHistoryFailed')),
                    });
                  }}
                  accept=".json"
                  showUploadList={false}
                >
                  <Tooltip title={t('chat.uploadConversation')}>
                    <Button color="default" variant="text" icon={<FileImportIcon />} />
                  </Tooltip>
                </Upload>
                <Tooltip title={t('chat.exportConversation')}>
                  <Button
                    color="default"
                    variant="text"
                    icon={<FileDownloadIcon />}
                    onClick={() => {
                      exportJsonArrayToFile(
                        conversations,
                        `ddrl_history_${dayjs().format('YYYY_MM_DD')}.json`
                      );
                      antdMessage.success(t('chat.exportSuccess'));
                    }}
                  />
                </Tooltip>
              </div>
            </Flex>
          </section>
        }
      >
        <Flex vertical style={{ height: '100%' }}>
          {conversations && (
            <ConversationsPanel
              items={chatHistoryItems}
              onActiveChange={(key) => onHistoryItemChange(Number(key))}
              groupable
              style={{ flex: 1 }}
            />
          )}
        </Flex>
      </Drawer>
    </main>
  );
};

export default HistoryPanel;
