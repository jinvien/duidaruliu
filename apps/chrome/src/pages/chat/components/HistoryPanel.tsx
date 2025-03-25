import React, { useEffect } from 'react';
import { App as AntdApp, Drawer, Upload, Button, Flex, Tooltip, Divider } from 'antd';
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
import { getTimeGroup } from '@/utils/date';
import { exportJsonArrayToFile, uploadHistoryMessages } from '@/utils/filesHelper';
import { queryCurrentTab } from '@/utils/tab';
import { contentWithPromptTag } from '@/utils/promptHelper';

// types
import type { GetProp } from 'antd';
import type { ConversationsProps } from '@ant-design/x';
import type { SetAppMode } from '@/entrypoints/sidepanel/App';

const HistoryPanel: React.FC<{ setAppMode: SetAppMode }> = ({ setAppMode }) => {
  const { message: antdMessage } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation();

  const DATE_GROUP_MAP = {
    today: i18n.t('utils.today'),
    lastDay: i18n.t('utils.lastDay'),
    last7Day: i18n.t('utils.last7Day'),
    last30Day: i18n.t('utils.last30Day'),
  };

  const { isShowHistoryPanel, conversations, isViewHistoryMode } = useAppSelector(
    (state) => state.history
  );
  const messages = useAppSelector((state) => state.chat.messages);
  const { ollamaModelParams } = useAppSelector((state) => state.ollama);
  const { isDarkMode, lang } = useAppSelector((state) => state.app);

  useEffect(() => {
    if (!isShowHistoryPanel) {
      return;
    }
    dispatch(initializeConversations());
  }, [isShowHistoryPanel]);

  const onHistoryItemChange = async (key: number) => {
    if (!isViewHistoryMode) {
      dispatch(storeCurrentMessages(messages));
      dispatch(setIsViewHistoryMode(true));
    }

    const { historyConversations } = await chrome.storage.local.get('historyConversations');
    const { lastModel, messages: selectedMessages } = historyConversations[key];

    dispatch(setOllamaModelParams({ ...ollamaModelParams, model: lastModel }));
    dispatch(setMessages({ messages: selectedMessages }));
  };

  const changeLanguage = async () => {
    const newLang = lang === 'en' ? 'zh-CN' : 'en';

    const { appSettings } = await chrome.storage.sync.get('appSettings');
    chrome.storage.sync.set({ appSettings: { ...appSettings, lang: newLang } });
  };

  const chatHistoryItems: GetProp<ConversationsProps, 'items'> = conversations?.map(
    ({ messages, lastUpdatedAt }, i) => {
      const [firstMessage, secondMessage] = messages;

      const { content: originalContent, role } = firstMessage;
      let displayedContent: string | React.ReactNode = originalContent;

      if (role === 'system') {
        const systemContent = secondMessage?.content || '';

        displayedContent =
          systemContent.length > 11 ? `${systemContent.slice(0, 10)}...` : systemContent;

        displayedContent = contentWithPromptTag(originalContent, displayedContent as string);
      } else {
        // 非系统消息直接截断
        displayedContent =
          originalContent.length > 11 ? `${originalContent.slice(0, 12)}...` : originalContent;
      }

      return {
        key: i.toString(),
        label: (
          <span>
            {displayedContent}
            <span
              style={{ fontSize: 'var(--ant-font-size-sm)', marginLeft: 'var(--ant-margin-xxs)' }}
            >
              {dayjs(lastUpdatedAt).format('HH:mm')}
            </span>
          </span>
        ),
        disabled: false,
        group: DATE_GROUP_MAP[getTimeGroup(lastUpdatedAt) as keyof typeof DATE_GROUP_MAP],
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
        width="260"
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
