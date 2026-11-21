import store from '@/store';
import { addMessage, setResponseStatus } from '@/store/chatSlice';
import { useAppDispatch } from '@/hooks/useStore';
import i18n from '@/i18n';
import { App as AntdApp } from 'antd';

import { abortAgent, agentIsStreaming, continueAgent, setChatErrorReporter } from '@/agent/runtime';

import type { OllamaModelParams } from './useOllama';
import type { Message } from '@/store/chatSlice';

export const useChat = () => {
  const dispatch = useAppDispatch();
  const { message: antdMessage } = AntdApp.useApp();

  const reportChatError = (error: unknown) => {
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
  };

  setChatErrorReporter(reportChatError);

  const sendMessage = async (tempOllamaParams?: OllamaModelParams) => {
    if (agentIsStreaming()) return;

    const messages = store.getState().chat.messages;
    const placeholder: Message = {
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: store.getState().ollama.ollamaModelParams.model,
    };
    dispatch(addMessage(placeholder));

    try {
      await continueAgent(messages, tempOllamaParams);
    } catch (error) {
      console.error('onChatError', error);
      dispatch(setResponseStatus('end'));
      reportChatError(error);
    }
  };

  return {
    sendMessage,
    abortControl: abortAgent,
  };
};
