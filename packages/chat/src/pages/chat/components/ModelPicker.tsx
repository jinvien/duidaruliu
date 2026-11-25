import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Dropdown, Segmented, Tooltip } from 'antd';
import { CheckOutlined, DownOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { storageSet } from '../../../host';
import { useAppDispatch, useAppSelector } from '../../../hooks/useStore';
import { useOllamaTags } from '../../../hooks/useOllama';
import { setOllamaModelParams } from '../../../store/ollamaSlice';
import {
  setActiveCustomModel,
  setCustomModelContext,
  setCustomModelThinking,
} from '../../../store/customModelSlice';
import {
  customModelIdFromKey,
  customModelKey,
  formatTokens,
  isCustomModelKey,
} from '../../../models/customModel';
import {
  findActiveCustomModel,
  selectActiveContextWindow,
  selectCombinedModels,
  selectCustomModels,
  selectSelectedModelKey,
  selectThinkingEnabled,
} from '../../../models/selection';
import { getMcpRuntime, subscribeMcpRuntime } from '../../../mcp/session';
import { explainChatTools, modelToolCapability } from '../../../mcp/toolGate';
import {
  modelCapabilityMark,
  modelHasTools,
  modelToolsMark,
  type CapabilityMark,
} from '../../../utils/modelCapability';

import Styles from '../index.module.less';

type ModelEntry = { key: string; name: string };

/**
 * 弹层内容。Dropdown 不会在弹层打开期间重渲染 popupRender 的返回值，
 * 所以这里是独立组件，自己订阅 store，切换开关后高亮才会立刻更新。
 */
const ModelPickerPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { ollamaModelParams, ollamaIsRunning, modelsStatus } = useAppSelector(
    (state) => state.ollama
  );
  const ollamaModels = useAppSelector((state) => state.ollama.listedModels);
  const mcpToolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const mcpServers = useAppSelector((state) => state.mcp.servers);
  const mcpRuntime = useSyncExternalStore(subscribeMcpRuntime, getMcpRuntime, getMcpRuntime);

  const customModels = useAppSelector(selectCustomModels);
  const activeCustom = useAppSelector(findActiveCustomModel);
  const allModels = useAppSelector(selectCombinedModels);
  const selectedKey = useAppSelector(selectSelectedModelKey);
  const thinkingEnabled = useAppSelector(selectThinkingEnabled);
  const contextWindow = useAppSelector(selectActiveContextWindow);

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

  const renderModelLabel = (entry: ModelEntry) => {
    const { key, name } = entry;
    if (!isCustomModelKey(key) && !ollamaIsRunning) return name;
    const vision = markText(modelCapabilityMark(allModels, key, listState), 'vision');
    const tools = markText(modelToolsMark(allModels, key, listState), 'tools');
    const gate = explainChatTools({
      toolsEnabled: mcpToolsEnabled,
      enabledServerCount: mcpServers.filter((server) => server.enabled).length,
      connectedToolCount: mcpRuntime.reduce(
        (count, server) => (server.status === 'connected' ? count + server.tools.length : count),
        0
      ),
      capability: modelToolCapability({
        hasTools: modelHasTools(allModels, key),
        mark: modelToolsMark(allModels, key, listState),
      }),
    });
    const unsupported =
      gate.kind === 'modelUnsupported' ? t('chat.toolsGate.modelUnsupportedShort') : '';
    return (
      <span className={Styles.modelOption}>
        <span className={Styles.modelName}>{name}</span>
        {vision ? <span className={Styles.modelVision}>{vision}</span> : null}
        {tools ? <span className={Styles.modelVision}>{tools}</span> : null}
        {unsupported ? <span className={Styles.modelVision}>{unsupported}</span> : null}
      </span>
    );
  };

  const choose = (key: string) => {
    if (isCustomModelKey(key)) {
      void dispatch(setActiveCustomModel(customModelIdFromKey(key)));
    } else {
      storageSet('sync', { ollamaModelParams: { ...ollamaModelParams, model: key } });
      void dispatch(setActiveCustomModel(null));
    }
    onClose();
  };

  const ollamaEntries: ModelEntry[] = ollamaModels.map(({ name }) => ({ key: name, name }));
  const customEntries: ModelEntry[] = customModels.map((model) => ({
    key: customModelKey(model.id),
    name: model.model,
  }));
  // 只有一类模型时保持平铺，两类并存才分组。
  const groups: { label?: string; entries: ModelEntry[] }[] =
    ollamaEntries.length && customEntries.length
      ? [
          { label: 'Ollama', entries: ollamaEntries },
          { label: t('customModel.group'), entries: customEntries },
        ]
      : [{ entries: [...ollamaEntries, ...customEntries] }];

  const renderEntry = (entry: ModelEntry) => {
    const selected = entry.key === selectedKey;
    return (
      <button
        key={entry.key}
        type="button"
        role="option"
        aria-selected={selected}
        className={`${Styles.pickerItem} ${selected ? Styles.pickerItemActive : ''}`}
        onClick={() => choose(entry.key)}
      >
        {renderModelLabel(entry)}
        <span className={Styles.pickerCheck}>{selected ? <CheckOutlined /> : null}</span>
      </button>
    );
  };

  const settings = activeCustom ? (
    <div className={Styles.pickerSettings}>
      <div className={Styles.pickerSetting}>
        <span>{t('chat.modelPicker.thinking')}</span>
        {activeCustom.thinking ? (
          <Segmented
            size="small"
            value={thinkingEnabled ? 'on' : 'off'}
            options={[
              { label: t('chat.modelPicker.thinkingOn'), value: 'on' },
              { label: t('chat.modelPicker.thinkingOff'), value: 'off' },
            ]}
            onChange={(value) =>
              void dispatch(setCustomModelThinking(activeCustom.id, value === 'on'))
            }
          />
        ) : (
          <Tooltip title={t('chat.modelPicker.thinkingUndeclared')}>
            <span className={Styles.pickerValue}>{t('chat.modelPicker.thinkingDefault')}</span>
          </Tooltip>
        )}
      </div>
      <div className={Styles.pickerSetting}>
        <span>{t('chat.modelPicker.context')}</span>
        {activeCustom.contextWindows.length > 1 ? (
          <Segmented
            size="small"
            value={contextWindow}
            options={activeCustom.contextWindows.map((tokens) => ({
              label: formatTokens(tokens),
              value: tokens,
            }))}
            onChange={(tokens) => void dispatch(setCustomModelContext(activeCustom.id, tokens))}
          />
        ) : (
          <Tooltip title={t('chat.modelPicker.contextHint')}>
            <span className={Styles.pickerValue}>
              {formatTokens(contextWindow) || t('chat.modelPicker.contextUnset')}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={Styles.pickerPanel}>
      <div className={Styles.pickerList} role="listbox">
        {groups.map((group, index) => (
          <React.Fragment key={group.label ?? index}>
            {group.label ? <div className={Styles.pickerGroup}>{group.label}</div> : null}
            {group.entries.map(renderEntry)}
          </React.Fragment>
        ))}
      </div>
      {settings}
    </div>
  );
};

/**
 * 输入框下方的模型选择。点开是模型列表，选中自定义模型时列表下面是这个模型的运行选项：
 * 思考开关和上下文窗口。
 */
const ModelPicker: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);

  const { ollamaModelParams, ollamaUrl, ollamaIsRunning } = useAppSelector((state) => state.ollama);
  // 这个 hook 负责拉取 Ollama 模型列表，只能调用一处。弹层里直接读 store。
  const { ollamaTags } = useOllamaTags(ollamaUrl);
  const customModels = useAppSelector(selectCustomModels);
  const activeCustom = useAppSelector(findActiveCustomModel);
  const selectedKey = useAppSelector(selectSelectedModelKey);
  const thinkingEnabled = useAppSelector(selectThinkingEnabled);
  const backendOnline = Boolean(activeCustom) || ollamaIsRunning;

  // 设置初始化模型
  useEffect(() => {
    // 如果模型列表为空或者已有 model，则不处理
    if (!ollamaTags.length || ollamaModelParams?.model) {
      return;
    }
    dispatch(setOllamaModelParams({ ...ollamaModelParams, model: ollamaTags[0].name }));
  }, [ollamaTags]);

  const disabled = !backendOnline && customModels.length === 0;
  const selectedName = isCustomModelKey(selectedKey)
    ? (customModels.find((model) => model.id === customModelIdFromKey(selectedKey))?.model ??
      selectedKey)
    : selectedKey;
  const triggerText = disabled
    ? t('chat.serviceUnreachable', { url: ollamaUrl })
    : selectedName || t('chat.modelPicker.empty');
  const thinkingOff = Boolean(activeCustom?.thinking) && !thinkingEnabled;

  return (
    <Dropdown
      open={open && !disabled}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="topLeft"
      disabled={disabled}
      popupRender={() => <ModelPickerPanel onClose={() => setOpen(false)} />}
    >
      <Button
        type="text"
        size="small"
        className={Styles.pickerTrigger}
        disabled={disabled}
        aria-label={t('chat.modelPicker.title')}
        aria-haspopup="listbox"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span
          className={`${Styles.pickerDot} ${backendOnline ? Styles.pickerDotOnline : ''}`}
          aria-hidden
        />
        <span className={Styles.pickerTriggerText}>{triggerText}</span>
        {thinkingOff ? (
          <span className={Styles.modelVision}>{t('chat.modelPicker.thinkingOffShort')}</span>
        ) : null}
        <DownOutlined className={Styles.pickerArrow} />
      </Button>
    </Dropdown>
  );
};

export default ModelPicker;
