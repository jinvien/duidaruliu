import store from '@/store';
import { addMessage, updateLastMessage, setResponseStatus } from '@/store/chatSlice';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';
import { streamingFetch } from '@/utils/streamFetch';
import { PROMPTS } from '@/constants/prompt';
import i18n from '@/i18n';

import type { OllamaModelParams } from './useOllama';
import type { Message } from '@/store/chatSlice';

// 因为本地AI回复较快，所以设置一个全局的计时器，当计时器超过 500ms 时再设置一个 loading状态
let loadingTimer: NodeJS.Timeout;

let abortControl: () => void;

export const useChat = () => {
  const dispatch = useAppDispatch();

  const { ollamaModelParams, ollamaUrl } = useAppSelector((state) => state.ollama);
  const { lang } = useAppSelector((state) => state.app);

  const sendMessage = async (tempOllamaParams?: OllamaModelParams) => {
    loadingTimer = setTimeout(() => {
      dispatch(setResponseStatus('waiting'));
    }, 500);

    let content = '';

    const controller = new AbortController();

    abortControl = () => {
      controller?.abort();
    };

    const modelConfig = tempOllamaParams ? tempOllamaParams : ollamaModelParams;

    const messages = store.getState().chat.messages;

    // 在消息队列末位添加一个助手消息
    const messageWithAssistant: Message = {
      role: 'assistant',
      content,
      createdAt: Date.now(),
      model: ollamaModelParams.model,
    };
    dispatch(addMessage(messageWithAssistant));

    let systemPrompt = '';

    // 移除 createAt 和 model 属性 ，因为其不是模型对话标准属性，仅用于本地记录
    let finalMessages = messages.map(({ createdAt, model, ...rest }) => {
      const { role, content } = rest;
      if (role === 'system') {
        systemPrompt = content;
      }

      // 在用户内容后有追加提示词，缓解不遵循提示词的问题
      if (role === 'user' && systemPrompt) {
        // 翻译助手
        if (systemPrompt === i18n.t('prompt.aiTranslateSelected.systemPrompt')) {
          const langFullnameMap: { [key: string]: string } = {
            zh: '中文',
            'zh-CN': '中文',
            en: 'English',
          };
          rest.content = `${content} \n ${i18n.t('prompt.aiTranslateSelected.postfix')}${langFullnameMap[lang]}`;
        }
      }

      return rest;
    });

    streamingFetch(
      {
        url: `${ollamaUrl}/api/chat`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: finalMessages,
          ...modelConfig,
        }),
        signal: controller.signal,
      },
      {
        onUpdate: (response) => {
          dispatch(setResponseStatus('outputting'));
          clearTimeout(loadingTimer);
          try {
            const chunkContent = response.message.content;

            // 将最后一条消息的内容和 AI助手的回复合并
            content += chunkContent;

            dispatch(updateLastMessage(content));
          } catch (e) {
            console.error(e);
          }
        },
        onSuccess: () => {
          dispatch(setResponseStatus('end'));
        },
        onError: (error) => {
          clearTimeout(loadingTimer);
          console.error('onChatError', error);
          if (error instanceof DOMException && error.name === 'AbortError') {
            dispatch(setResponseStatus('end'));
          }
        },
      }
    );
  };

  return {
    sendMessage,
    abortControl,
  };
};
