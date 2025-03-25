import { useState, useEffect } from 'react';
import { App as AntdApp, Button, Form, Input, Space, Divider } from 'antd';
import { useTranslation } from 'react-i18next';

import { AddRectangleIcon, MinusRectangleIcon } from 'tdesign-icons-react';

const CustomLink: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [links] = useState([]);

  const fetchCustomLink = async () => {
    const { customLinks } = await chrome.storage.sync.get('customLinks');
    form.setFieldsValue({ links: customLinks });
  };

  useEffect(() => {
    fetchCustomLink();
  }, []);

  const onFinish = async (values: any) => {
    await chrome.storage.sync.set({
      customLinks: values.links,
    });
    antdMessage.success(t('formAction.saveSuccess'));
  };

  const onReset = () => {
    form.setFieldsValue([]);
  };

  return (
    <section>
      <Form
        form={form}
        name="link-setting"
        onFinish={onFinish}
        layout="vertical"
        initialValues={{ links }}
      >
        <Divider orientation="left">{t('customLinkSetting.linkSetting')}</Divider>
        <p>{t('customLinkSetting.usedForQuickOpen')}</p>
        <Form.List name="links">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }, index) => (
                <Form.Item key={key} label={`${t('customLinkSetting.link')} ${index + 1}`}>
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item
                      {...restField}
                      name={[name, 'title']}
                      noStyle
                      rules={[{ required: true, message: t('customLinkSetting.inputTitle') }]}
                    >
                      <Input
                        placeholder={t('customLinkSetting.inputTitlePlaceholder')}
                        style={{ width: 240 }}
                      />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'url']}
                      noStyle
                      rules={[
                        { required: true, message: t('customLinkSetting.inputWebSite') },
                        { type: 'url', message: t('customLinkSetting.inputWebSitePlaceholder') },
                      ]}
                    >
                      <Input placeholder={t('customLinkSetting.linkAddress')} />
                    </Form.Item>
                    <Button onClick={() => remove(name)} icon={<MinusRectangleIcon />} />
                  </Space.Compact>
                </Form.Item>
              ))}
              <Form.Item>
                <Button onClick={() => add()} block icon={<AddRectangleIcon />}>
                  {t('customLinkSetting.addLink')}
                </Button>
              </Form.Item>
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

export default CustomLink;
