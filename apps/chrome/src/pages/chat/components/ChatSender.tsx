import { FC, useCallback, useState } from 'react';
import { Sender, Suggestion } from '@ant-design/x';
import { Flex, Alert } from 'antd';
import { EnterIcon, Filter2Icon, Filter3Icon, CloseIcon } from 'tdesign-icons-react';
import { useAppSelector, useAppDispatch } from '@/hooks/useStore';
import { setIsViewHistoryMode } from '@/store/historySlice';
import { addMessage } from '@/store/chatSlice';
import { useChat } from '@/hooks/useChat';

const ChatSender: FC = () => {
  const dispatch = useAppDispatch();
  const { ollamaIsRunning } = useAppSelector((state) => state.ollama);
  const { responseStatus } = useAppSelector((state) => state.chat);
  const prompts = useAppSelector((state) => state.prompt).map((prompt) => ({
    ...prompt,
    icon: prompt.type === 'quick' ? <Filter2Icon /> : <Filter3Icon />,
  }));

  const [userContent, setUserContent] = useState<string>('');
  const [submitType, setSubmitType] = useState<'enter' | 'shiftEnter' | false>('enter');
  const [selectedSystemPrompt, setSelectedSystemPrompt] = useState<{
    label: string;
    value: string;
  } | null>(null);

  const { sendMessage, abortControl } = useChat();

  const handleSubmit = useCallback(() => {
    dispatch(setIsViewHistoryMode(false));
    setUserContent('');
    setSelectedSystemPrompt(null);

    if (selectedSystemPrompt) {
      dispatch(
        addMessage({ role: 'system', content: selectedSystemPrompt.value, createdAt: Date.now() })
      );
    }
    dispatch(addMessage({ role: 'user', content: userContent, createdAt: Date.now() }));
    sendMessage();
  }, [userContent]);

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
              loading={responseStatus === 'outputting'}
              submitType={submitType}
              value={userContent}
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
