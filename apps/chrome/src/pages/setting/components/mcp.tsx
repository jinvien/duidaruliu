import { useEffect, useRef, useState } from 'react';
import { App as AntdApp, Alert, Button, Divider, Input, Switch, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import { MCP_RUNTIME_PUSH, MCP_RUNTIME_QUERY } from '@/mcp/bridge';
import {
  parseMcpServersDocument,
  serversToMcpDocument,
  type McpConfigIssue,
} from '@/mcp/jsonConfig';
import { MCP_MODEL_TOOL_CAP } from '@/mcp/tools';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';
import { setMcpServers, setMcpToolsEnabled } from '@/store/mcpSlice';

import type { McpConnectionStatus, McpServerRuntime } from '@/mcp/session';

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

  const statusText = (name: string) => {
    const current = runtime.find((item) => item.name === name);
    const status: McpConnectionStatus = current?.status ?? 'idle';
    if (status === 'connecting') return t('mcpSetting.statusConnecting');
    if (status === 'connected') return t('mcpSetting.statusConnected');
    if (status === 'auth') return t('mcpSetting.authRequired');
    if (status === 'stdio') return t('mcpSetting.stdioOnly');
    if (status === 'error') {
      return current?.detail
        ? t('mcpSetting.statusErrorDetail', { detail: current.detail })
        : t('mcpSetting.statusError');
    }
    return t('mcpSetting.statusIdle');
  };

  const statusColor = (name: string) => {
    const status = runtime.find((item) => item.name === name)?.status ?? 'idle';
    if (status === 'connected') return 'success';
    if (status === 'connecting') return 'processing';
    if (status === 'auth' || status === 'stdio') return 'warning';
    if (status === 'error') return 'error';
    return 'default';
  };

  return (
    <section>
      <Divider orientation="left">{t('mcpSetting.title')}</Divider>
      <Alert
        type="info"
        showIcon
        message={t('mcpSetting.storageNotice')}
        style={{ marginBottom: 12 }}
      />
      <Alert type="info" showIcon message={t('mcpSetting.jsonHelp')} style={{ marginBottom: 12 }} />
      <Alert
        type="info"
        showIcon
        message={t('mcpSetting.jsonExamples')}
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 8 }}>{t('mcpSetting.jsonLabel')}</div>
      <Input.TextArea
        value={text}
        spellCheck={false}
        autoSize={{ minRows: 16, maxRows: 28 }}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
        onChange={(event) => {
          dirty.current = true;
          setText(event.target.value);
        }}
      />
      {issues.length ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
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
      <div style={{ textAlign: 'right', margin: '16px 0' }}>
        <Button type="primary" disabled={!loaded} onClick={() => void save()}>
          {t('formAction.save')}
        </Button>
      </div>
      <FormTools
        toolsEnabled={toolsEnabled}
        onChange={(checked) => {
          dispatch(setMcpToolsEnabled(checked));
          void chrome.storage.local.set({ mcpToolsEnabled: checked });
        }}
        label={t('mcpSetting.toolsEnabled')}
        extra={t('mcpSetting.toolsEnabledExtra')}
      />
      {runtime.reduce((count, item) => count + item.tools.length, 0) > MCP_MODEL_TOOL_CAP ? (
        <Alert
          type="warning"
          showIcon
          message={t('mcpSetting.toolCap', { count: MCP_MODEL_TOOL_CAP })}
          style={{ margin: '12px 0' }}
        />
      ) : null}
      <div style={{ marginTop: 8 }}>
        <strong>{t('mcpSetting.savedServers')}</strong>
        {servers.length ? (
          servers.map((server) => {
            const tools = runtime.find((item) => item.name === server.name)?.tools ?? [];
            const showTools =
              runtime.find((item) => item.name === server.name)?.status === 'connected';
            return (
              <div key={server.name} style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  <Tag color={statusColor(server.name)}>{server.name}</Tag>
                  <span>{statusText(server.name)}</span>
                </div>
                {showTools ? (
                  <div style={{ marginBottom: 8 }}>
                    <strong>{t('mcpSetting.tools')}</strong>
                    {tools.length ? (
                      <ul>
                        {tools.map((tool) => (
                          <li key={tool.name}>
                            {tool.name}
                            {tool.description ? ` — ${tool.description}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{t('mcpSetting.noTools')}</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p>{t('mcpSetting.noServers')}</p>
        )}
      </div>
    </section>
  );
};

function FormTools(props: {
  toolsEnabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  extra: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div>{props.label}</div>
      <Switch checked={props.toolsEnabled} onChange={props.onChange} />
      <div style={{ color: 'var(--ant-color-text-description)' }}>{props.extra}</div>
    </div>
  );
}

export default McpSetting;
