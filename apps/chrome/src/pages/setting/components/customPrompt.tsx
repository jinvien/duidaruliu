import { useState, useEffect } from 'react';
import { App as AntdApp, Button, Form, Input, Space, Divider, Radio, Flex, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

import {
  AddRectangleIcon,
  MinusRectangleIcon,
  Filter2Icon,
  Filter3Icon,
} from 'tdesign-icons-react';

const CustomPrompt: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [prompts] = useState([]);

  const fetchCustomPrompt = async () => {
    const { customPrompts } = await chrome.storage.sync.get('customPrompts');
    form.setFieldsValue({ prompts: customPrompts });
  };

  useEffect(() => {
    fetchCustomPrompt();
  }, []);

  const onFinish = async (values: any) => {
    await chrome.storage.sync.set({
      customPrompts: values.prompts,
    });
    antdMessage.success(t('customPromptSetting.saveSuccess'));
  };

  const onReset = () => {
    form.setFieldsValue([]);
  };

  return (
    <section>
      <Form
        form={form}
        name="prompt-setting"
        onFinish={onFinish}
        layout="vertical"
        initialValues={{ prompts }}
      >
        <Divider orientation="left">{t('customPromptSetting.promptSetting')}</Divider>
        <p>{t('customPromptSetting.usedForQuickOpen')}</p>
        <Form.List name="prompts">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }, index) => (
                <div key={key}>
                  <Form.Item
                    style={{ marginBottom: 4 }}
                    label={
                      <strong>
                        {t('customPromptSetting.prompt')} {index + 1}
                      </strong>
                    }
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item
                        {...restField}
                        name={[name, 'label']}
                        noStyle
                        rules={[
                          { required: true, message: t('customPromptSetting.inputLabelTip') },
                        ]}
                      >
                        <Input.TextArea
                          placeholder={t('customPromptSetting.inputLabelPlaceholder')}
                          style={{ width: 240 }}
                        />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'value']}
                        noStyle
                        rules={[
                          { required: true, message: t('customPromptSetting.inputValueTip') },
                        ]}
                      >
                        <Input.TextArea
                          placeholder={t('customPromptSetting.inputValuePlaceholder')}
                        />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                  <Flex justify="space-between">
                    <Form.Item {...restField} name={[name, 'type']}>
                      <Radio.Group
                        style={{ borderRadius: 0 }}
                        optionType="button"
                        options={[
                          {
                            value: 'quick',
                            label: (
                              <Flex align="center" gap="small">
                                <Filter2Icon /> {t('customPromptSetting.quickPrompt')}
                              </Flex>
                            ),
                          },
                          {
                            value: 'system',
                            label: (
                              <Flex align="center" gap="small">
                                <Filter3Icon /> {t('customPromptSetting.systemPrompt')}
                              </Flex>
                            ),
                          },
                        ]}
                      />
                    </Form.Item>

                    <Form.Item>
                      <Space.Compact>
                        <Button onClick={() => remove(name)} icon={<MinusRectangleIcon />}>
                          {t('formAction.delete')}
                        </Button>
                        <Button
                          onClick={() => add({ type: 'quick' }, index + 1)}
                          icon={<AddRectangleIcon />}
                        >
                          {t('formAction.add')}
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                  </Flex>
                </div>
              ))}
              {!fields.length && (
                <Button
                  block
                  style={{ marginBottom: 'var(--ant-margin)' }}
                  onClick={() => add({ type: 'quick' })}
                  icon={<AddRectangleIcon />}
                >
                  {t('formAction.add')}
                </Button>
              )}
            </>
          )}
        </Form.List>

        <Form.Item style={{ textAlign: 'right' }}>
          <Space>
            <Button type="primary" htmlType="submit">
              {t('formAction.save')}
            </Button>

            <Button htmlType="button" onClick={onReset}>
              {t('formAction.clear')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </section>
  );
};

export default CustomPrompt;
