import { useEffect } from 'react';
import i18n from '../i18n';
import { App as AntdApp } from 'antd';

import { abortAgent, setChatErrorReporter, startAssistantTurn } from '../agent/runtime';

export const useChat = () => {
  const { message: antdMessage } = AntdApp.useApp();

  useEffect(() => {
    setChatErrorReporter((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof Error && error.name === 'AbortError') return;
      const detail = error instanceof Error ? error.message.trim() : '';
      const statusOnly = detail.match(/^HTTP (\d+)$/);
      if (statusOnly) {
        antdMessage.error(i18n.t('chat.requestFailedStatus', { status: statusOnly[1] }));
        return;
      }
      if (!detail || /failed to fetch|networkerror|load failed/i.test(detail)) {
        antdMessage.error(i18n.t('chat.requestFailed'));
        return;
      }
      antdMessage.error(i18n.t('chat.requestFailedDetail', { detail }));
    });
  }, [antdMessage]);

  return {
    sendMessage: startAssistantTurn,
    abortControl: abortAgent,
  };
};
