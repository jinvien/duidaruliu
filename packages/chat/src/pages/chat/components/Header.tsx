import { storageSet } from '../../../host';
import React, { useEffect, useSyncExternalStore } from 'react';
import { App as AntdApp, Button, Space, Select, Badge, Tooltip } from 'antd';
import { MenuOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { agentIsStreaming, getAgentActivity, resetAgentTranscript, subscribeAgentActivity } from '../../../agent/runtime';
import { useAppDispatch, useAppSelector } from '../../../hooks/useStore';
import { bumpModelsNonce, checkOllamaStatus, setOllamaModelParams } from '../../../store/ollamaSlice';
import { setMessages } from '../../../store/chatSlice';
import {
  initializeConversations,
  setIsShowHistoryPanel,
  setIsViewHistoryMode,
  storeCurrentMessagesFunc,
} from '../../../store/historySlice';

import { useOllamaTags } from '../../../hooks/useOllama';
import { getMcpRuntime, subscribeMcpRuntime } from '../../../mcp/session';
import { explainChatTools, modelToolCapability } from '../../../mcp/toolGate';
import {
  modelCapabilityMark,
  modelHasTools,
  modelToolsMark,
  type CapabilityMark,
} from '../../../utils/modelCapability';

// import local styles
import Styles from '../index.module.less';

const HeaderSection: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { ollamaModelParams, ollamaUrl, ollamaIsRunning, modelsStatus, serviceError } =
    useAppSelector((state) => state.ollama);
  useSyncExternalStore(subscribeAgentActivity, getAgentActivity, getAgentActivity);
  const messages = useAppSelector((state) => state.chat.messages);
  const { isViewHistoryMode, isShowHistoryPanel } = useAppSelector((state) => state.history);
  const { responseStatus } = useAppSelector((state) => state.chat);
  const mcpToolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const mcpServers = useAppSelector((state) => state.mcp.servers);
  const mcpRuntime = useSyncExternalStore(subscribeMcpRuntime, getMcpRuntime, getMcpRuntime);

  const { ollamaTags } = useOllamaTags(ollamaUrl);

  // 设置初始化模型
  useEffect(() => {
    // 如果模型列表为空或者已有 model，则不处理
    if (!ollamaTags.length || ollamaModelParams?.model) {
      return;
    }
    dispatch(setOllamaModelParams({ ...ollamaModelParams, model: ollamaTags[0].name }));
  }, [ollamaTags]);

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

  const listState = modelsStatus === 'idle' ? 'loading' : modelsStatus;
  const markText = (mark: CapabilityMark | null, kind: 'vision' | 'tools') => {
    if (mark === 'vision') return t('chat.vision');
    if (mark === 'tools') return t('chat.tools');
    if (mark === 'pending')
      return t(kind === 'vision' ? 'chat.visionChecking' : 'chat.toolsChecking');
    if (mark === 'unknown')
      return t(kind === 'vision' ? 'chat.visionUnknown' : 'chat.toolsUnknown');
    return '';
  };

  const renderModelLabel = (name: string) => {
    if (!ollamaIsRunning) return name;
    const vision = markText(modelCapabilityMark(ollamaTags, name, listState), 'vision');
    const tools = markText(modelToolsMark(ollamaTags, name, listState), 'tools');
    const gate = explainChatTools({
      toolsEnabled: mcpToolsEnabled,
      enabledServerCount: mcpServers.filter((server) => server.enabled).length,
      connectedToolCount: mcpRuntime.reduce(
        (count, server) => (server.status === 'connected' ? count + server.tools.length : count),
        0
      ),
      capability: modelToolCapability({
        hasTools: modelHasTools(ollamaTags, name),
        mark: modelToolsMark(ollamaTags, name, listState),
      }),
    });
    const unsupported =
      gate.kind === 'modelUnsupported' ? t('chat.toolsGate.modelUnsupportedShort') : '';
    return (
      <span className={Styles.modelOption}>
        <span>{name}</span>
        {vision ? <span className={Styles.modelVision}>{vision}</span> : null}
        {tools ? <span className={Styles.modelVision}>{tools}</span> : null}
        {unsupported ? <span className={Styles.modelVision}>{unsupported}</span> : null}
      </span>
    );
  };

  const mcpDisconnected =
    mcpToolsEnabled &&
    mcpServers.some(
      (server) =>
        server.enabled &&
        mcpRuntime.find((item) => item.name === server.name)?.status !== 'connected'
    );

  const serviceProblem = !ollamaIsRunning || modelsStatus === 'error';
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
        <Badge status={ollamaIsRunning ? 'success' : 'default'} />
        {mcpDisconnected ? (
          <Tooltip title={t('chat.mcpDisconnected')}>
            <Badge status="warning" />
          </Tooltip>
        ) : null}
        <Select
          disabled={!ollamaIsRunning}
          variant="borderless"
          value={ollamaIsRunning ? ollamaModelParams.model : t('chat.serviceUnreachable', { url: ollamaUrl })}
          popupMatchSelectWidth={false}
          options={ollamaTags.map(({ name }) => ({
            value: name,
            label: name,
          }))}
          labelRender={(item) => renderModelLabel(String(item.value ?? item.label ?? ''))}
          optionRender={(option) => renderModelLabel(String(option.value ?? ''))}
          onChange={(value) => {
            storageSet('sync', { ollamaModelParams: { ...ollamaModelParams, model: value } });
          }}
        />
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
