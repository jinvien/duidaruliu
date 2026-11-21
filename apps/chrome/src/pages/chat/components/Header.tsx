import React, { useEffect, useSyncExternalStore } from 'react';
import { App as AntdApp, Button, Space, Select, Badge, Tooltip } from 'antd';
import { MenuApplicationIcon, ChatAddIcon } from 'tdesign-icons-react';
import { useTranslation } from 'react-i18next';

import { agentIsStreaming, resetAgentTranscript } from '@/agent/runtime';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';
import { setOllamaModelParams } from '@/store/ollamaSlice';
import { setMessages } from '@/store/chatSlice';
import { setIsShowHistoryPanel, setIsViewHistoryMode } from '@/store/historySlice';

import { useOllamaTags } from '@/hooks/useOllama';
import { getMcpRuntime, subscribeMcpRuntime } from '@/mcp/session';
import { modelCapabilityMark, modelToolsMark, type CapabilityMark } from '@/utils/modelCapability';

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
    dispatch(
      setMessages({
        messages: [],
        isSaveCurrent: !isViewHistoryMode,
      })
    );
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
    return (
      <span className={Styles.modelOption}>
        <span>{name}</span>
        {vision ? <span className={Styles.modelVision}>{vision}</span> : null}
        {tools ? <span className={Styles.modelVision}>{tools}</span> : null}
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
        {mcpDisconnected ? (
          <Tooltip title={t('chat.mcpDisconnected')}>
            <Badge status="warning" />
          </Tooltip>
        ) : null}
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
