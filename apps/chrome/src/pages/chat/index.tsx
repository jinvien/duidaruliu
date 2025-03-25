import React, { useEffect } from 'react';
import { Layout } from 'antd';
import { useTranslation } from 'react-i18next';

// import components
import HeaderSection from './components/Header';
import ChatContent from './components/ChatContent';
import HistoryPanel from './components/HistoryPanel';
import ChatSender from './components/ChatSender';

// import hooks
import { useChat } from '@/hooks/useChat';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';

// import store
import { setMessages } from '@/store/chatSlice';
import { setIsViewHistoryMode, setIsShowHistoryPanel } from '@/store/historySlice';

// import constants
import { SELECTION_COMMANDS } from '@/constants/command';
import { PROMPTS } from '@/constants/prompt';

// import styles
import Styles from './index.module.less';

import type { SetAppMode } from '@/entrypoints/sidepanel/App';
import type { Message } from '@/store/chatSlice';

const ChatPage: React.FC<{ setAppMode: SetAppMode }> = ({ setAppMode }) => {
  // hooks
  const { sendMessage } = useChat();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { ollamaModelParams } = useAppSelector((state) => state.ollama);
  const { isViewHistoryMode } = useAppSelector((state) => state.history);

  const handleContextMenus = async (bgMessage: { type: string; text?: string }) => {
    if (bgMessage.type !== SELECTION_COMMANDS.TRANSLATE_SELECTED) {
      return;
    }

    const translatedModelConfig = {
      ...ollamaModelParams,
      options: { ...ollamaModelParams.options, temperature: PROMPTS.TRANSLATE.TEMPERATURE },
    };

    const translateMessages: Message[] = [
      {
        role: 'system',
        content: t('prompt.aiTranslateSelected.systemPrompt'),
        model: ollamaModelParams.model,
        createdAt: Date.now(),
      },
      {
        role: 'user',
        content: bgMessage.text || '',
        createdAt: Date.now(),
      },
    ];
    await dispatch(
      setMessages({
        messages: translateMessages,
        isSaveCurrent: !isViewHistoryMode,
      })
    );

    dispatch(setIsViewHistoryMode(false));
    dispatch(setIsShowHistoryPanel(false));

    await sendMessage(translatedModelConfig);
  };

  useEffect(() => {
    chrome.runtime.onMessage.addListener(handleContextMenus);
    return () => chrome.runtime.onMessage.removeListener(handleContextMenus);
  }, [ollamaModelParams]);

  return (
    <main>
      <Layout className={Styles.layout}>
        <HeaderSection />
        <Layout.Content className={Styles.content}>
          <ChatContent />
        </Layout.Content>
        <footer className={Styles.footer}>
          <ChatSender />
        </footer>
      </Layout>
      <HistoryPanel setAppMode={setAppMode} />
    </main>
  );
};

export default ChatPage;
