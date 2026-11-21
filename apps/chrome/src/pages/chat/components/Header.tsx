import React, { useEffect } from 'react';
import { App as AntdApp, Button, Space, Select, Badge, Tooltip } from 'antd';
import { MenuApplicationIcon, ChatAddIcon } from 'tdesign-icons-react';
import { useTranslation } from 'react-i18next';

import { useAppDispatch, useAppSelector } from '@/hooks/useStore';
import { setOllamaModelParams } from '@/store/ollamaSlice';
import { setMessages } from '@/store/chatSlice';
import { setIsShowHistoryPanel, setIsViewHistoryMode } from '@/store/historySlice';

import { useOllamaTags } from '@/hooks/useOllama';
import { modelCapabilityMark, type CapabilityMark } from '@/utils/modelCapability';

// import local styles
import Styles from '../index.module.less';

const HeaderSection: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { ollamaModelParams, ollamaUrl, ollamaIsRunning, modelsStatus } = useAppSelector(
    (state) => state.ollama
  );
  const messages = useAppSelector((state) => state.chat.messages);
  const { isViewHistoryMode } = useAppSelector((state) => state.history);
  const { responseStatus } = useAppSelector((state) => state.chat);

  const { ollamaTags } = useOllamaTags(ollamaUrl);

  // 设置初始化模型
  useEffect(() => {
    // 如果模型列表为空或者已有 model，则不处理
    if (!ollamaTags.length || ollamaModelParams?.model) {
      return;
    }
    dispatch(setOllamaModelParams({ ...ollamaModelParams, model: ollamaTags[0].name }));
  }, [ollamaTags]);

  const createNewChat = async () => {
    if (responseStatus !== 'end') {
      antdMessage.warning(t('chat.waitingForEnd'));
      return;
    }

    if (!messages.length) {
      antdMessage.success(t('chat.isLatest'));
      return;
    }
    if (isViewHistoryMode) {
      dispatch(setIsViewHistoryMode(false));
    }
    // 新增对话
    dispatch(
      setMessages({
        messages: [],
        isSaveCurrent: !isViewHistoryMode,
      })
    );
  };

  const markText = (mark: CapabilityMark | null) => {
    if (mark === 'vision') return t('chat.vision');
    if (mark === 'pending') return t('chat.visionChecking');
    if (mark === 'unknown') return t('chat.visionUnknown');
    return '';
  };

  const renderModelLabel = (name: string) => {
    if (!ollamaIsRunning) return name;
    const text = markText(
      modelCapabilityMark(ollamaTags, name, modelsStatus === 'idle' ? 'loading' : modelsStatus)
    );
    return (
      <span className={Styles.modelOption}>
        <span>{name}</span>
        {text ? <span className={Styles.modelVision}>{text}</span> : null}
      </span>
    );
  };

  return (
    <header className={Styles.header}>
      <div className={Styles.left}>
        <Tooltip title={t('chat.openSideMenu')} placement="right">
          <Button
            variant="text"
            color="default"
            icon={<MenuApplicationIcon />}
            onClick={() => {
              dispatch(setIsShowHistoryPanel(true));
            }}
          />
        </Tooltip>
      </div>
      <div className={Styles.middle}>
        <Badge status={ollamaIsRunning ? 'success' : 'default'} />
        <Select
          disabled={!ollamaIsRunning}
          variant="borderless"
          value={ollamaIsRunning ? ollamaModelParams.model : t('chat.serverNotStart')}
          popupMatchSelectWidth={false}
          options={ollamaTags.map(({ name }) => ({
            value: name,
            label: name,
          }))}
          labelRender={(item) => renderModelLabel(String(item.value ?? item.label ?? ''))}
          optionRender={(option) => renderModelLabel(String(option.value ?? ''))}
          onChange={(value) => {
            chrome.storage.sync.set({ ollamaModelParams: { ...ollamaModelParams, model: value } });
          }}
        />
      </div>
      <Space size={2} className={Styles.right}>
        <Tooltip title={t('chat.newChat')} placement="left">
          <Button
            variant="text"
            color="default"
            icon={<ChatAddIcon />}
            onClick={() => createNewChat()}
          />
        </Tooltip>
      </Space>
    </header>
  );
};

export default HeaderSection;
