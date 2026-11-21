import { useEffect, useRef, useState } from 'react';
import { App as AntdApp, Alert, Button, Collapse, Divider, Input, Switch, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import { MCP_RUNTIME_PUSH, MCP_RUNTIME_QUERY } from '@/mcp/bridge';
import {
  parseMcpServersDocument,
  serversToMcpDocument,
  type McpConfigIssue,
} from '@/mcp/jsonConfig';
import { summarizeSavedServer, type SavedServerStatus } from '@/mcp/serverSummary';
import { MCP_MODEL_TOOL_CAP } from '@/mcp/tools';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';
import { setMcpServers, setMcpToolsEnabled } from '@/store/mcpSlice';

import Styles from './mcp.module.less';

import type { McpServerRuntime } from '@/mcp/session';

const ISSUE_KEY: Record<McpConfigIssue['code'], string> = {
  json: 'issueJson',
  shape: 'issueShape',
  name: 'issueName',
  stdio: 'issueStdio',
  sse: 'issueSse',
  oauth: 'issueOauth',
  unsupported: 'issueUnsupported',
  invalid: 'issueInvalid',
  duplicate: 'issueDuplicate',
};

const STATUS_COLOR: Record<SavedServerStatus, string> = {
  disabled: 'default',
  idle: 'default',
  connecting: 'processing',
  connected: 'success',
  auth: 'warning',
  stdio: 'warning',
  error: 'error',
};

const McpSetting: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const servers = useAppSelector((state) => state.mcp.servers);
  const loaded = useAppSelector((state) => state.mcp.loaded);
  const toolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const [runtime, setRuntime] = useState<McpServerRuntime[]>([]);
  const [text, setText] = useState('');
  const [issues, setIssues] = useState<McpConfigIssue[]>([]);
  const dirty = useRef(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!loaded) return;
    if (dirty.current && hydrated.current) return;
    setText(serversToMcpDocument(servers));
    hydrated.current = true;
  }, [loaded, servers]);

  useEffect(() => {
    if (!chrome.runtime?.onMessage) return;
    const onMessage = (message: { type?: string; runtime?: McpServerRuntime[] }) => {
      if (message?.type === MCP_RUNTIME_PUSH && Array.isArray(message.runtime)) {
        setRuntime(message.runtime);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    void Promise.resolve(chrome.runtime.sendMessage({ type: MCP_RUNTIME_QUERY }))
      .then((response: { runtime?: McpServerRuntime[] } | undefined) => {
        if (Array.isArray(response?.runtime)) setRuntime(response.runtime);
      })
      .catch(() => undefined);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const save = async () => {
    const parsed = parseMcpServersDocument(text);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      return;
    }
    await chrome.storage.local.set({ mcpServers: parsed.servers });
    dispatch(setMcpServers(parsed.servers));
    dirty.current = false;
    setText(serversToMcpDocument(parsed.servers));
    setIssues([]);
    antdMessage.success(t('mcpSetting.jsonSaved'));
  };

  const statusLabel = (status: SavedServerStatus, detail?: string) => {
    if (status === 'disabled') return t('mcpSetting.statusDisabled');
    if (status === 'connecting') return t('mcpSetting.statusConnecting');
    if (status === 'connected') return t('mcpSetting.statusConnected');
    if (status === 'auth') return t('mcpSetting.authRequired');
    if (status === 'stdio') return t('mcpSetting.stdioOnly');
    if (status === 'error') {
      return detail ? t('mcpSetting.statusErrorDetail', { detail }) : t('mcpSetting.statusError');
    }
    return t('mcpSetting.statusIdle');
  };

  const connectedToolCount = runtime.reduce(
    (count, server) => (server.status === 'connected' ? count + server.tools.length : count),
    0
  );

  return (
    <section className={Styles.page}>
      <Divider orientation="left">{t('mcpSetting.title')}</Divider>

      <div className={Styles.switchRow}>
        <div>
          <div>{t('mcpSetting.toolsEnabled')}</div>
          <p className={Styles.hint}>{t('mcpSetting.toolsEnabledExtra')}</p>
        </div>
        <Switch
          checked={toolsEnabled}
          onChange={(checked) => {
            dispatch(setMcpToolsEnabled(checked));
            void chrome.storage.local.set({ mcpToolsEnabled: checked });
          }}
        />
      </div>

      <div className={Styles.block}>
        <div>{t('mcpSetting.savedServers')}</div>
        <p className={Styles.hint}>{t('mcpSetting.connectionIsNotChat')}</p>
        {!loaded ? <p className={Styles.hint}>{t('mcpSetting.loading')}</p> : null}
        {loaded && servers.length === 0 ? (
          <p className={Styles.hint}>{t('mcpSetting.noServers')}</p>
        ) : null}
        {loaded && servers.length > 0 ? (
          <Collapse
            size="small"
            items={servers.map((server) => {
              const current = runtime.find((item) => item.name === server.name);
              const summary = summarizeSavedServer(server, current);
              const tools = summary.status === 'connected' ? (current?.tools ?? []) : [];
              return {
                key: server.name,
                label: (
                  <span className={Styles.serverLabel}>
                    <span className={Styles.serverName}>{server.name}</span>
                    <Tag color={STATUS_COLOR[summary.status]}>
                      {summary.status === 'error'
                        ? t('mcpSetting.statusError')
                        : statusLabel(summary.status)}
                    </Tag>
                    {summary.status === 'connected' ? (
                      <span className={Styles.hint}>
                        {t('mcpSetting.toolCount', { count: summary.toolCount })}
                      </span>
                    ) : null}
                  </span>
                ),
                children: (
                  <div className={Styles.toolPanel}>
                    {summary.status === 'connected' ? (
                      tools.length ? (
                        tools.map((tool) => (
                          <div key={tool.name} className={Styles.toolItem}>
                            <div className={Styles.toolName}>{tool.name}</div>
                            {tool.description ? (
                              <p className={Styles.toolDesc}>{tool.description}</p>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className={Styles.hint}>{t('mcpSetting.noTools')}</p>
                      )
                    ) : (
                      <p className={Styles.detail}>{statusLabel(summary.status, summary.detail)}</p>
                    )}
                  </div>
                ),
              };
            })}
          />
        ) : null}
        {connectedToolCount > MCP_MODEL_TOOL_CAP ? (
          <Alert
            type="warning"
            showIcon
            message={t('mcpSetting.toolCap', { count: MCP_MODEL_TOOL_CAP })}
          />
        ) : null}
      </div>

      <div className={Styles.block}>
        <div className={Styles.editorHead}>
          <span>{t('mcpSetting.jsonLabel')}</span>
          <Button type="primary" disabled={!loaded} onClick={() => void save()}>
            {t('formAction.save')}
          </Button>
        </div>
        <p className={Styles.hint}>{t('mcpSetting.storageNotice')}</p>
        <Input.TextArea
          className={Styles.editor}
          value={text}
          spellCheck={false}
          rows={12}
          disabled={!loaded}
          onChange={(event) => {
            dirty.current = true;
            setText(event.target.value);
          }}
        />
        {issues.length ? (
          <Alert
            type="error"
            showIcon
            message={t('mcpSetting.jsonRejected')}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {issues.map((item, index) => (
                  <li key={`${item.code}-${item.server ?? ''}-${index}`}>
                    {t(`mcpSetting.${ISSUE_KEY[item.code]}`, {
                      server: item.server ?? '',
                      detail: item.detail ?? '',
                    }).trim()}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
      </div>

      <Collapse
        size="small"
        items={[
          {
            key: 'help',
            label: t('mcpSetting.helpTitle'),
            children: (
              <div className={Styles.help}>
                <p>{t('mcpSetting.jsonHelp')}</p>
                <p>{t('mcpSetting.jsonExamples')}</p>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
};

export default McpSetting;
