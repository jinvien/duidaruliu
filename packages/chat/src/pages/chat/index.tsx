import React, { useEffect, useRef } from 'react';
import { Layout } from 'antd';
import { useTranslation } from 'react-i18next';

// import components
import HeaderSection from './components/Header';
import ChatContent from './components/ChatContent';
import HistoryPanel from './components/HistoryPanel';
import ChatSender from './components/ChatSender';

// import hooks
import { useChat } from '../../hooks/useChat';
import { useAppDispatch, useAppSelector } from '../../hooks/useStore';

// import store
import { setIsViewHistoryMode, setIsShowHistoryPanel } from '../../store/historySlice';
import { replaceConversationForTranslate } from './translateConversation';
import { loadPageRef } from '../../store/pageSlice';

// import constants
import { getChatHost } from '../../host';
import { SELECTION_COMMANDS } from '../../constants/command';
import { selectSelectedModelLabel } from '../../models/selection';
import { PROMPTS } from '../../constants/prompt';

// import styles
import Styles from './index.module.less';

import { useChatLayout, useMinWidth } from '../../shell/layout';
import type { SetAppMode } from '../../shell/types';
import type { Message } from '../../store/chatSlice';

const ChatPage: React.FC<{ setAppMode: SetAppMode }> = ({ setAppMode }) => {
  // hooks
  const { sendMessage } = useChat();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { ollamaModelParams } = useAppSelector((state) => state.ollama);
  const modelLabel = useAppSelector(selectSelectedModelLabel);
  const { isViewHistoryMode } = useAppSelector((state) => state.history);
  const layout = useChatLayout();
  const wide = useMinWidth(960);
  const dockHistory = layout === 'desktop' && wide;
  const openedDock = useRef(false);

  useEffect(() => {
    if (!dockHistory || openedDock.current) return;
    openedDock.current = true;
    dispatch(setIsShowHistoryPanel(true));
  }, [dispatch, dockHistory]);

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
        model: modelLabel,
        createdAt: Date.now(),
      },
      {
        role: 'user',
        content: bgMessage.text || '',
        createdAt: Date.now(),
      },
    ];
    await replaceConversationForTranslate({
      dispatch,
      messages: translateMessages,
      saveCurrent: !isViewHistoryMode,
      send: sendMessage,
      override: translatedModelConfig,
      onReplaced: () => {
        dispatch(setIsViewHistoryMode(false));
        dispatch(setIsShowHistoryPanel(false));
      },
    });
  };

  useEffect(() => {
    return getChatHost().subscribeHostCommand?.(handleContextMenus);
  }, [ollamaModelParams, modelLabel]);

  // 右键菜单等入口请求引用页面。订阅时宿主会补发还没处理的请求。
  useEffect(() => {
    return getChatHost().subscribePageRequest?.((request) => {
      void loadPageRef(dispatch, request.tabId);
    });
  }, [dispatch]);

  return (
    <main className={Styles.page}>
      {dockHistory ? <HistoryPanel docked setAppMode={setAppMode} /> : null}
      <Layout className={Styles.layout}>
        <HeaderSection />
        <Layout.Content className={Styles.content}>
          <div className={layout === 'desktop' ? Styles.reading : undefined} style={{ height: '100%' }}>
            <ChatContent />
          </div>
        </Layout.Content>
        <footer className={Styles.footer}>
          <div className={layout === 'desktop' ? Styles.reading : undefined}>
            <ChatSender />
          </div>
        </footer>
      </Layout>
      {dockHistory ? null : <HistoryPanel setAppMode={setAppMode} />}
    </main>
  );
};

export default ChatPage;
