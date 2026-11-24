import { useRef, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { fetchRemoteModelIds, testCustomModelConnection } from '../../../agent/customStream';
import {
  TOKEN_K,
  cleanContextWindows,
  cleanModelNames,
  draftToCustomService,
  effectiveProtocol,
  emptyCustomServiceDraft,
  expandCustomService,
  formatTokens,
  isValidModelUrl,
  modelsListUrl,
  parseTokenCount,
  validateCustomService,
  type CustomProtocol,
  type CustomService,
  type CustomServiceDraft,
} from '../../../models/customModel';
import { useAppDispatch, useAppSelector } from '../../../hooks/useStore';
import {
  removeCustomService,
  saveCustomService,
  setActiveCustomModel,
} from '../../../store/customModelSlice';

import Styles from './customModel.module.less';

const PROTOCOL_LABEL: Record<CustomProtocol, string> = {
  chat_completions: 'Chat Completions',
  responses: 'Responses',
  messages: 'Claude Messages',
};

const CONTEXT_CHIPS = [128, 256, 512, 1024];
const OUTPUT_CHIPS = [8, 16, 32, 64];

/** 可以输入多个上下文窗口，回车或逗号分隔，支持 300K、1M、1048576 这类写法。 */
const ContextWindowsInput: React.FC<{
  value?: number[];
  onChange?: (value: number[]) => void;
  placeholder?: string;
}> = ({ value = [], onChange, placeholder }) => (
  <Select
    mode="tags"
    open={false}
    suffixIcon={null}
    tokenSeparators={[',', ' ', '、', '\n']}
    value={value.map(formatTokens)}
    placeholder={placeholder}
    onChange={(items: string[]) =>
      onChange?.(cleanContextWindows(items.map((item) => parseTokenCount(item))))
    }
  />
);

function serviceTitle(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const ServiceDialog: React.FC<{
  draft: CustomServiceDraft;
  onClose: () => void;
}> = ({ draft, onClose }) => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<CustomServiceDraft>();
  const customProtocol = Form.useWatch('customProtocol', form);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const fetchedFor = useRef('');
  const isEdit = Boolean(draft.id);

  const current = (): CustomServiceDraft => ({ ...draft, ...form.getFieldsValue(true) });

  const loadRemoteModels = async () => {
    const { url, apiKey } = current();
    const listUrl = modelsListUrl(url);
    const signature = `${listUrl}|${apiKey}`;
    if (!listUrl || fetchedFor.current === signature) return;
    fetchedFor.current = signature;
    setRemoteModels(await fetchRemoteModelIds(listUrl, apiKey.trim()));
  };

  const testConnection = async () => {
    const values = current();
    if (validateCustomService(values)) {
      antdMessage.warning(t('customModel.testNeedFields'));
      return;
    }
    setTesting(true);
    try {
      // 同一个服务下的每个模型都试一次，名字写错的会单独指出来。
      const results = await Promise.all(
        expandCustomService(draftToCustomService(values)).map(async (model) => ({
          name: model.model,
          result: await testCustomModelConnection(model),
        }))
      );
      const failures = results.flatMap(({ name, result }) =>
        result.ok ? [] : [`${name}: ${result.error}`]
      );
      if (failures.length) {
        antdMessage.error(t('customModel.testFailed', { detail: failures.join('; ') }));
        return;
      }
      const elapsed = Math.max(...results.map(({ result }) => (result.ok ? result.elapsedMs : 0)));
      antdMessage.success(t('customModel.testOk', { count: results.length, ms: elapsed }));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await dispatch(saveCustomService(draftToCustomService(current())));
      antdMessage.success(t('customModel.saved'));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const chips = (values: number[], field: 'contextWindows' | 'maxOutputTokens') => (
    <div className={Styles.chips}>
      {values.map((value) => (
        <Button
          key={value}
          size="small"
          type="text"
          onClick={() => {
            const tokens = value * TOKEN_K;
            if (field === 'maxOutputTokens') {
              form.setFieldValue(field, tokens);
              return;
            }
            // 上下文窗口可以多选，再点一次取消。
            const picked = cleanContextWindows(form.getFieldValue(field));
            form.setFieldValue(
              field,
              picked.includes(tokens)
                ? picked.filter((item) => item !== tokens)
                : cleanContextWindows([...picked, tokens])
            );
          }}
        >
          {value}K
        </Button>
      ))}
    </div>
  );

  return (
    <Modal
      open
      width={560}
      title={t(isEdit ? 'customModel.edit' : 'customModel.add')}
      okText={t('customModel.save')}
      cancelText={t('customModel.cancel')}
      confirmLoading={saving}
      onOk={save}
      onCancel={onClose}
      maskClosable={false}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={draft}
        requiredMark={false}
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="url"
          extra={t('customModel.urlExtra')}
          rules={[
            {
              validator: (_, value: string) =>
                isValidModelUrl(value ?? '')
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('customModel.urlInvalid'))),
            },
          ]}
        >
          <Input
            placeholder="https://api.example.com/v1/chat/completions"
            autoComplete="off"
            spellCheck={false}
          />
        </Form.Item>

        <Form.Item label="API Key">
          <div className={Styles.keyRow}>
            <Form.Item name="apiKey" noStyle>
              <Input.Password
                placeholder={t('customModel.apiKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
              />
            </Form.Item>
            <Button loading={testing} onClick={testConnection}>
              {t('customModel.testConnection')}
            </Button>
          </div>
        </Form.Item>

        <Form.Item
          name="models"
          label={t('customModel.modelName')}
          extra={t('customModel.modelNameExtra')}
          rules={[
            {
              validator: (_, value: string[]) =>
                cleanModelNames(value).length > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('customModel.modelRequired'))),
            },
          ]}
        >
          <Select
            mode="tags"
            tokenSeparators={[',', ' ', '\n']}
            placeholder={t('customModel.modelNamePlaceholder')}
            options={remoteModels.map((id) => ({ value: id }))}
            // 拉不到模型列表时不弹空的下拉，直接输入后回车即可。
            open={remoteModels.length ? undefined : false}
            onFocus={() => void loadRemoteModels()}
          />
        </Form.Item>

        <Form.Item label={t('customModel.advanced')} style={{ marginBottom: 12 }}>
          <div className={Styles.checks}>
            <Form.Item name="tools" valuePropName="checked" noStyle>
              <Checkbox>{t('customModel.toolCalling')}</Checkbox>
            </Form.Item>
            <Form.Item name="vision" valuePropName="checked" noStyle>
              <Checkbox>{t('customModel.imageInput')}</Checkbox>
            </Form.Item>
            <Form.Item name="thinking" valuePropName="checked" noStyle>
              <Checkbox>{t('customModel.thinking')}</Checkbox>
            </Form.Item>
            <Form.Item name="customProtocol" valuePropName="checked" noStyle>
              <Checkbox>{t('customModel.customProtocol')}</Checkbox>
            </Form.Item>
          </div>
          <div className={Styles.sharedHint}>{t('customModel.sharedHint')}</div>
          {customProtocol ? (
            <div className={Styles.protocolPanel}>
              <Form.Item name="protocol" label={t('customModel.protocol')} style={{ margin: 0 }}>
                <Select
                  options={(Object.keys(PROTOCOL_LABEL) as CustomProtocol[]).map((value) => ({
                    value,
                    label: PROTOCOL_LABEL[value],
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="sessionHeaders"
                valuePropName="checked"
                extra={t('customModel.sessionHeadersExtra')}
                style={{ margin: 0 }}
              >
                <Checkbox>{t('customModel.sessionHeaders')}</Checkbox>
              </Form.Item>
            </div>
          ) : null}
        </Form.Item>

        <div className={Styles.limits}>
          <div>
            <Form.Item
              name="contextWindows"
              label={t('customModel.context')}
              extra={t('customModel.contextExtra')}
            >
              <ContextWindowsInput placeholder={t('customModel.contextPlaceholder')} />
            </Form.Item>
            {chips(CONTEXT_CHIPS, 'contextWindows')}
          </div>
          <div>
            <Form.Item
              name="maxOutputTokens"
              label={t('customModel.output')}
              extra={t('customModel.outputExtra')}
            >
              <InputNumber
                min={1}
                precision={0}
                controls={false}
                style={{ width: '100%' }}
                placeholder={t('customModel.providerDefault')}
              />
            </Form.Item>
            {chips(OUTPUT_CHIPS, 'maxOutputTokens')}
          </div>
        </div>
      </Form>
    </Modal>
  );
};

const CustomModelSetting: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const services = useAppSelector((state) => state.customModel.services);
  const activeId = useAppSelector((state) => state.customModel.activeId);
  const [editing, setEditing] = useState<CustomServiceDraft | null>(null);

  const remove = async (service: CustomService) => {
    await dispatch(removeCustomService(service.id));
    antdMessage.success(t('customModel.deleted'));
  };

  return (
    <section className={Styles.page}>
      <Divider titlePlacement="left" style={{ margin: 0 }}>
        {t('customModel.title')}
      </Divider>
      <p className={Styles.hint}>{t('customModel.description')}</p>
      <div className={Styles.head}>
        <span className={Styles.hint}>{services.length ? t('customModel.listHint') : ''}</span>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing(emptyCustomServiceDraft())}
        >
          {t('customModel.add')}
        </Button>
      </div>

      {services.length === 0 ? <p className={Styles.hint}>{t('customModel.empty')}</p> : null}

      <div className={Styles.list}>
        {services.map((service) => (
          <div key={service.id} className={Styles.item}>
            <div className={Styles.itemMain}>
              <div className={Styles.itemTitle}>
                <span>{serviceTitle(service.url)}</span>
              </div>
              <div className={Styles.itemUrl} title={service.url}>
                {service.url}
              </div>
              <div className={Styles.tags}>
                {expandCustomService(service).map((model) => (
                  <Tag.CheckableTag
                    key={model.id}
                    checked={model.id === activeId}
                    onChange={() => void dispatch(setActiveCustomModel(model.id))}
                  >
                    {model.model}
                  </Tag.CheckableTag>
                ))}
              </div>
              <div className={Styles.tags}>
                <Tag>{PROTOCOL_LABEL[effectiveProtocol(service)]}</Tag>
                {service.tools ? <Tag>{t('chat.tools')}</Tag> : null}
                {service.vision ? <Tag>{t('chat.vision')}</Tag> : null}
                {service.thinking ? <Tag>{t('customModel.thinking')}</Tag> : null}
                {service.contextWindows.length ? (
                  <Tag>
                    {t('customModel.context')}{' '}
                    {service.contextWindows.map(formatTokens).join(' / ')}
                  </Tag>
                ) : null}
                {service.maxOutputTokens ? (
                  <Tag>
                    {t('customModel.output')} {formatTokens(service.maxOutputTokens)}
                  </Tag>
                ) : null}
              </div>
            </div>
            <Space className={Styles.actions} size={4}>
              <Button size="small" onClick={() => setEditing({ ...service })}>
                {t('customModel.editAction')}
              </Button>
              <Popconfirm
                title={t('customModel.deleteConfirm', { name: serviceTitle(service.url) })}
                okText={t('formAction.delete')}
                cancelText={t('customModel.cancel')}
                onConfirm={() => remove(service)}
              >
                <Button size="small" danger>
                  {t('formAction.delete')}
                </Button>
              </Popconfirm>
            </Space>
          </div>
        ))}
      </div>

      {editing ? <ServiceDialog draft={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
};

export default CustomModelSetting;
