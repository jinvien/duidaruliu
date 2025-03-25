import { useEffect, CSSProperties } from 'react';
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  Space,
  Divider,
  InputNumber,
  Collapse,
  Row,
  Col,
} from 'antd';
import { useTranslation } from 'react-i18next';

import { DEFAULT_OLLAMA_URL } from '@/constants/command';

import type { OllamaModelParams } from '@/hooks/useOllama';
import type { OllamaSetting } from '@/store/ollamaSlice';

const StyleFullWidth: CSSProperties = { width: '100%' };

const defaultOllamaSettings = {
  url: DEFAULT_OLLAMA_URL,
};

let tempOllamaModelParams: OllamaModelParams;
let tempOllamaSettings: OllamaSetting;

const OllamaSetting: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();

  const [ollamaForm] = Form.useForm();
  const [modelForm] = Form.useForm();

  const fetchOllamaInfo = async () => {
    // 初始化 Ollama 配置信息
    const { ollamaSettings } = await chrome.storage.sync.get('ollamaSettings');
    tempOllamaSettings = ollamaSettings;
    ollamaForm.setFieldsValue(ollamaSettings);

    // 初始化 OllamaModel 配置信息
    const { ollamaModelParams } = await chrome.storage.sync.get('ollamaModelParams');
    tempOllamaModelParams = ollamaModelParams;
    modelForm.setFieldsValue(ollamaModelParams);
  };

  useEffect(() => {
    fetchOllamaInfo();
  }, []);

  const onOllamaFinish = async (values: any) => {
    chrome.storage.sync.set({ ollamaSettings: { ...tempOllamaSettings, url: values.url } });
    antdMessage.success(t('ollamaSetting.ollamaSettingSuccess'));
  };

  const onModelFinish = async (values: any) => {
    const ollamaModelParams: OllamaModelParams = {
      ...tempOllamaModelParams,
      ...values,
    };
    chrome.storage.sync.set({ ollamaModelParams });
    antdMessage.success(t('ollamaSetting.modelSettingSuccess'));
  };

  const onResetOllama = () => {
    ollamaForm.setFieldsValue(defaultOllamaSettings);
  };

  const onResetModel = () => {
    modelForm.resetFields();
  };
  return (
    <section>
      <Form form={ollamaForm} name="ollama-setting" onFinish={onOllamaFinish} layout="vertical">
        <Divider orientation="left">{t('ollamaSetting.baseSetting')}</Divider>
        <Form.Item name="url" label="Ollama URL" rules={[{ required: true }]}>
          <Input />
        </Form.Item>

        <Form.Item style={{ textAlign: 'right' }}>
          <Space>
            <Button type="primary" htmlType="submit">
              {t('formAction.save')}
            </Button>
            <Button htmlType="button" onClick={onResetOllama}>
              {t('ollamaSetting.reset')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
      <Form form={modelForm} name="ollama-model-setting" onFinish={onModelFinish} layout="vertical">
        <Divider orientation="left">{t('ollamaSetting.modelParamsTip')}</Divider>
        <div
          style={{ color: 'var(--ant-color-text-description)', marginBottom: 'var(--ant-margin)' }}
        >
          {t('ollamaSetting.modelParamsTip1')}
          <Space>
            <a href="https://github.com/ollama/ollama/blob/main/docs/api.md" target="_blank">
              Ollama API
            </a>

            <a
              href="https://github.com/ollama/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values"
              target="_blank"
            >
              Ollama Model File
            </a>
          </Space>
        </div>
        <Form.Item
          name="keep_alive"
          label={t('ollamaSetting.keepAliveLabel')}
          extra={t('ollamaSetting.keepAliveExtra')}
        >
          <InputNumber step="1" min="0" style={StyleFullWidth} />
        </Form.Item>
        <Form.Item
          name={['options', 'temperature']}
          label={t('ollamaSetting.temperatureLabel')}
          extra={t('ollamaSetting.temperatureExtra')}
        >
          <InputNumber step="0.1" style={StyleFullWidth} />
        </Form.Item>
        <Form.Item
          name={['options', 'num_ctx']}
          label={t('ollamaSetting.numCtxLabel')}
          extra={t('ollamaSetting.numCtxExtra')}
        >
          <InputNumber step="1024" style={StyleFullWidth} />
        </Form.Item>
        <Form.Item
          name={['options', 'num_predict']}
          label={t('ollamaSetting.numPredictLabel')}
          extra={t('ollamaSetting.numPredictExtra')}
        >
          <InputNumber step="0.1" style={StyleFullWidth} />
        </Form.Item>
        <Collapse
          items={[
            {
              key: '1',
              label: t('ollamaSetting.moreParams'),
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name={['options', 'top_k']} label="top_k">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['options', 'top_p']} label="top_p">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['options', 'min_p']} label="min_p">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name={['options', 'mirostat']} label="mirostat">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['options', 'mirostat_eta']} label="mirostat_eta">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['options', 'mirostat_tau']} label="mirostat_tau">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name={['options', 'repeat_last_n']} label="repeat_last_n">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['options', 'repeat_penalty']} label="repeat_penalty">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['options', 'seed']} label="seed">
                        <InputNumber style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name={['options', 'stop']} label="stop">
                        <Input style={StyleFullWidth} />
                      </Form.Item>
                    </Col>
                    <Col span={16}></Col>
                  </Row>
                </>
              ),
            },
          ]}
        ></Collapse>

        <Form.Item style={{ textAlign: 'right', marginTop: '20px' }}>
          <Space>
            <Button type="primary" htmlType="submit">
              {t('formAction.save')}
            </Button>
            <Button htmlType="button" onClick={onResetModel}>
              {t('formAction.clear')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </section>
  );
};

export default OllamaSetting;
