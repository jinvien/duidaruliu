import { useEffect, useRef, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
} from 'antd';
import { useTranslation } from 'react-i18next';

import { MCP_RUNTIME_PUSH, MCP_RUNTIME_QUERY } from '@/mcp/bridge';
import { rewriteOriginForSave } from '@/mcp/page';
import { inspectMcpServer, type McpServerRuntime } from '@/mcp/session';
import { MCP_MODEL_TOOL_CAP } from '@/mcp/tools';
import { mcpOriginRewriteDefault, type McpServerRecord } from '@/mcp/types';
import { useAppDispatch, useAppSelector } from '@/hooks/useStore';
import { setMcpServers, setMcpToolsEnabled } from '@/store/mcpSlice';

import type { McpConnectionStatus } from '@/mcp/session';

const McpSetting: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const servers = useAppSelector((state) => state.mcp.servers);
  const loaded = useAppSelector((state) => state.mcp.loaded);
  const toolsEnabled = useAppSelector((state) => state.mcp.toolsEnabled);
  const [runtime, setRuntime] = useState<McpServerRuntime[]>([]);
  const rewriteTouched = useRef(new Set<string>());
  const [form] = Form.useForm<{ servers: McpServerRecord[] }>();
  const watched = Form.useWatch('servers', form) as McpServerRecord[] | undefined;

  useEffect(() => {
    if (!loaded) return;
    form.setFieldsValue({ servers });
  }, [form, loaded, servers]);

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

  const adjustRewrite = (index: number, url: string) => {
    const current = (form.getFieldValue('servers') as McpServerRecord[] | undefined)?.[index];
    if (!current) return;
    const previous = mcpOriginRewriteDefault(current.url ?? '');
    const next = mcpOriginRewriteDefault(url);
    if (current.rewriteOrigin === previous && previous !== next) {
      form.setFieldValue(['servers', index, 'rewriteOrigin'], next);
    }
  };

  const onFinish = async (values: { servers?: McpServerRecord[] }) => {
    const next = (values.servers ?? []).map((server, index) => {
      const name = server.name?.trim() ?? '';
      const url = server.url?.trim() ?? '';
      const saved = servers.some((item) => item.name === name);
      const touched =
        rewriteTouched.current.has(`index:${index}`) || rewriteTouched.current.has(`name:${name}`);
      const record: McpServerRecord = {
        name,
        url,
        headers: (server.headers ?? []).filter((header) => header?.name?.trim() || header?.value),
        timeout: server.timeout || 30,
        enabled: server.enabled !== false,
        rewriteOrigin: rewriteOriginForSave(url, Boolean(server.rewriteOrigin), touched || saved),
      };
      if (server.command) record.command = server.command;
      return record;
    });
    const names = new Set<string>();
    for (const server of next) {
      if (names.has(server.name)) {
        antdMessage.error(t('mcpSetting.duplicateName'));
        return;
      }
      if (server.name) names.add(server.name);
      const inspected = inspectMcpServer(server);
      if (!inspected.ok && inspected.status !== 'stdio') {
        antdMessage.error(t('mcpSetting.invalid', { detail: inspected.detail ?? server.name }));
        return;
      }
    }

    await chrome.storage.local.set({ mcpServers: next });
    dispatch(setMcpServers(next));
    antdMessage.success(t('mcpSetting.saved'));
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
      <Form form={form} name="mcp-setting" layout="vertical" onFinish={onFinish}>
        <Divider orientation="left">{t('mcpSetting.title')}</Divider>
        <Alert
          type="info"
          showIcon
          message={t('mcpSetting.storageNotice')}
          style={{ marginBottom: 16 }}
        />
        <Form.Item label={t('mcpSetting.toolsEnabled')} extra={t('mcpSetting.toolsEnabledExtra')}>
          <Switch
            checked={toolsEnabled}
            onChange={(checked) => {
              dispatch(setMcpToolsEnabled(checked));
              void chrome.storage.local.set({ mcpToolsEnabled: checked });
            }}
          />
        </Form.Item>
        {runtime.reduce((count, item) => count + item.tools.length, 0) > MCP_MODEL_TOOL_CAP ? (
          <Alert
            type="warning"
            showIcon
            message={t('mcpSetting.toolCap', { count: MCP_MODEL_TOOL_CAP })}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form.List name="servers">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name }) => {
                const server = watched?.[name];
                const serverName = server?.name ?? '';
                const tools = runtime.find((item) => item.name === serverName)?.tools ?? [];
                const showTools =
                  runtime.find((item) => item.name === serverName)?.status === 'connected';
                return (
                  <div key={key}>
                    <Form.Item name={[name, 'command']} hidden>
                      <Input />
                    </Form.Item>
                    {server?.command && !server.url ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={t('mcpSetting.stdioOnly')}
                        style={{ marginBottom: 12 }}
                      />
                    ) : null}
                    <Form.Item
                      name={[name, 'name']}
                      label={t('mcpSetting.name')}
                      rules={[{ required: true, message: t('mcpSetting.name') }]}
                    >
                      <Input placeholder={t('mcpSetting.namePlaceholder')} />
                    </Form.Item>
                    <Form.Item name={[name, 'url']} label={t('mcpSetting.url')}>
                      <Input
                        placeholder="http://127.0.0.1:8080/mcp"
                        onBlur={(event) => adjustRewrite(name, event.target.value)}
                      />
                    </Form.Item>
                    <Form.Item label={t('mcpSetting.headers')}>
                      <Form.List name={[name, 'headers']}>
                        {(headerFields, headerOps) => (
                          <>
                            {headerFields.map((header) => (
                              <Space
                                key={header.key}
                                align="baseline"
                                style={{ display: 'flex', marginBottom: 8 }}
                              >
                                <Form.Item name={[header.name, 'name']} noStyle>
                                  <Input placeholder={t('mcpSetting.headerName')} />
                                </Form.Item>
                                <Form.Item name={[header.name, 'value']} noStyle>
                                  <Input placeholder={t('mcpSetting.headerValue')} />
                                </Form.Item>
                                <Button type="link" onClick={() => headerOps.remove(header.name)}>
                                  {t('mcpSetting.removeHeader')}
                                </Button>
                              </Space>
                            ))}
                            <Button
                              type="dashed"
                              onClick={() => headerOps.add({ name: '', value: '' })}
                            >
                              {t('mcpSetting.addHeader')}
                            </Button>
                          </>
                        )}
                      </Form.List>
                    </Form.Item>
                    <Space size="large" wrap>
                      <Form.Item
                        name={[name, 'enabled']}
                        label={t('mcpSetting.enabled')}
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item name={[name, 'timeout']} label={t('mcpSetting.timeout')}>
                        <InputNumber min={1} step={1} />
                      </Form.Item>
                      <Form.Item
                        name={[name, 'rewriteOrigin']}
                        label={t('mcpSetting.rewriteOrigin')}
                        extra={t('mcpSetting.rewriteOriginExtra')}
                        valuePropName="checked"
                      >
                        <Switch
                          onClick={() => {
                            rewriteTouched.current.add(`index:${name}`);
                            const serverName = String(
                              form.getFieldValue(['servers', name, 'name']) ?? ''
                            ).trim();
                            if (serverName) rewriteTouched.current.add(`name:${serverName}`);
                          }}
                        />
                      </Form.Item>
                    </Space>
                    <div style={{ marginBottom: 8 }}>
                      <Tag color={statusColor(serverName)}>{statusText(serverName)}</Tag>
                    </div>
                    {showTools ? (
                      <div style={{ marginBottom: 16 }}>
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
                    <div style={{ textAlign: 'right', marginBottom: 24 }}>
                      <Button danger onClick={() => remove(name)}>
                        {t('mcpSetting.removeServer')}
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button
                type="dashed"
                onClick={() =>
                  add({
                    name: '',
                    url: '',
                    headers: [],
                    enabled: true,
                    timeout: 30,
                    rewriteOrigin: false,
                  })
                }
              >
                {t('mcpSetting.addServer')}
              </Button>
            </>
          )}
        </Form.List>
        <Form.Item style={{ textAlign: 'right', marginTop: 16 }}>
          <Button type="primary" htmlType="submit">
            {t('formAction.save')}
          </Button>
        </Form.Item>
      </Form>
    </section>
  );
};

export default McpSetting;
