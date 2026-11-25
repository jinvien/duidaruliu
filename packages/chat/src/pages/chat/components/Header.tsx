import React, { useSyncExternalStore } from 'react';
import { App as AntdApp, Button, Space, Badge, Tooltip } from 'antd';
import { MenuOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { agentIsStreaming, getAgentActivity, resetAgentTranscript, subscribeAgentActivity } from '../../../agent/runtime';
import { useAppDispatch, useAppSelector } from '../../../hooks/useStore';
import { bumpModelsNonce, checkOllamaStatus } from '../../../store/ollamaSlice';
import { setMessages } from '../../../store/chatSlice';
import { findActiveCustomModel } from '../../../models/selection';
import {
  initializeConversations,
  setIsShowHistoryPanel,
  setIsViewHistoryMode,
  storeCurrentMessagesFunc,
} from '../../../store/historySlice';

import { getMcpRuntime, subscribeMcpRuntime } from '../../../mcp/session';

// import local styles
import Styles from '../index.module.less';

const HeaderSection: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { ollamaUrl, ollamaIsRunning, modelsStatus, serviceError } = useAppSelector(
    (state) => state.ollama
  );
  useSyncExternalStore(subscribeAgentActivity, getAgentActivity, getAgentActivity);
  const messages = useAppSelector((state) => state.chat.messages);
  const { isViewHistoryMode, isShowHistoryPanel } = useAppSelector((state) => state.history);
  const { responseStatus } = useAppSelector((state) => state.chat);
  const mcpToolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const mcpServers = useAppSelector((state) => state.mcp.servers);
  const mcpRuntime = useSyncExternalStore(subscribeMcpRuntime, getMcpRuntime, getMcpRuntime);

  const activeCustom = useAppSelector(findActiveCustomModel);

  const retryService = () => {
    dispatch(checkOllamaStatus(ollamaUrl));
    dispatch(bumpModelsNonce());
  };

  const createNewChat = async () => {
    if (agentIsStreaming() || responseStatus !== 'end') {
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
    if (!resetAgentTranscript()) return;
    const saved = messages;
    dispatch(setMessages({ messages: [], isSaveCurrent: false }));
    if (!isViewHistoryMode) {
      await storeCurrentMessagesFunc(saved);
      dispatch(initializeConversations());
    }
  };

  const mcpDisconnected =
    mcpToolsEnabled &&
    mcpServers.some(
      (server) =>
        server.enabled &&
        mcpRuntime.find((item) => item.name === server.name)?.status !== 'connected'
    );

  // 选中自定义模型时，本机 Ollama 的状态与当前对话无关，不打扰。
  const serviceProblem = !activeCustom && (!ollamaIsRunning || modelsStatus === 'error');
  const serviceText = !ollamaIsRunning
    ? serviceError
      ? t('chat.serviceUnreachableDetail', { url: ollamaUrl, detail: serviceError })
      : t('chat.serviceUnreachable', { url: ollamaUrl })
    : t('chat.modelsLoadFailed', { url: ollamaUrl });

  return (
    <header className={Styles.header}>
      <div className={Styles.left}>
        <Tooltip title={t('chat.openSideMenu')} placement="right">
          <Button
            variant="text"
            color="default"
            icon={<MenuOutlined />}
            aria-label={t('chat.openSideMenu')}
            onClick={() => {
              dispatch(setIsShowHistoryPanel(!isShowHistoryPanel));
            }}
          />
        </Tooltip>
      </div>
      <div className={Styles.middle}>
        {mcpDisconnected ? (
          <Tooltip title={t('chat.mcpDisconnected')}>
            <Badge status="warning" />
          </Tooltip>
        ) : null}
      </div>
      <Space size={2} className={Styles.right}>
        <Tooltip title={t('chat.newChat')} placement="left">
          <Button
            variant="text"
            color="default"
            icon={<PlusOutlined />}
            aria-label={t('chat.newChat')}
            onClick={() => createNewChat()}
          />
        </Tooltip>
      </Space>
      {serviceProblem ? (
        <div className={Styles.serviceRow} role="status">
          <span>{serviceText}</span>
          <Button size="small" icon={<ReloadOutlined />} onClick={retryService}>
            {t('chat.serviceRetry')}
          </Button>
        </div>
      ) : null}
    </header>
  );
};

export default HeaderSection;
