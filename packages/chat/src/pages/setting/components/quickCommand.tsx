import { storageGet, storageSet } from '../../../host';
import { useEffect } from 'react';
import { App as AntdApp, Button, Card, Divider, Empty, Flex, Form, Input, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { MinusOutlined, PlusOutlined } from '@ant-design/icons';

import {
  ARTICLE_CATEGORY_ID,
  buildDefaultQuickCommands,
  newId,
  normalizeQuickCommands,
  type QuickCommandCategory,
} from '../../../utils/quickCommand';

type FormValues = { categories: QuickCommandCategory[] };

const QuickCommandSetting: React.FC = () => {
  const { message: antdMessage } = AntdApp.useApp();
  const { t } = useTranslation();
  const [form] = Form.useForm<FormValues>();
  const categories = Form.useWatch('categories', form);

  useEffect(() => {
    void (async () => {
      const { quickCommands } = await storageGet('sync', 'quickCommands');
      form.setFieldsValue({ categories: normalizeQuickCommands(quickCommands, navigator.language) });
    })();
  }, [form]);

  const onFinish = async (values: FormValues) => {
    await storageSet('sync', { quickCommands: values.categories ?? [] });
    antdMessage.success(t('formAction.saveSuccess'));
  };

  const onRestoreDefault = () => {
    form.setFieldsValue({ categories: buildDefaultQuickCommands(navigator.language) });
    antdMessage.info(t('quickCommandSetting.restored'));
  };

  return (
    <section>
      <Form
        form={form}
        name="quick-command-setting"
        onFinish={onFinish}
        layout="vertical"
        initialValues={{ categories: [] }}
      >
        <Divider titlePlacement="left">{t('quickCommandSetting.title')}</Divider>
        <p>{t('quickCommandSetting.description')}</p>

        <Form.List name="categories">
          {(fields, { add, remove }) => (
            <Flex vertical gap="middle">
              {fields.map(({ key, name, ...restField }, index) => {
                const isDefault = categories?.[index]?.id === ARTICLE_CATEGORY_ID;
                return (
                  <Card
                    key={key}
                    size="small"
                    title={
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        noStyle
                        rules={[
                          {
                            required: true,
                            whitespace: true,
                            message: t('quickCommandSetting.categoryNameRequired'),
                          },
                        ]}
                      >
                        <Input
                          variant="borderless"
                          style={{ fontWeight: 600 }}
                          placeholder={t('quickCommandSetting.categoryNamePlaceholder')}
                        />
                      </Form.Item>
                    }
                    extra={
                      <Button
                        size="small"
                        type="text"
                        danger
                        disabled={isDefault}
                        title={isDefault ? t('quickCommandSetting.defaultCategoryTip') : undefined}
                        icon={<MinusOutlined />}
                        onClick={() => remove(name)}
                      >
                        {t('quickCommandSetting.deleteCategory')}
                      </Button>
                    }
                  >
                    <Form.Item {...restField} name={[name, 'id']} hidden>
                      <Input />
                    </Form.Item>

                    <Form.List name={[name, 'commands']}>
                      {(commandFields, { add: addCommand, remove: removeCommand }) => (
                        <Flex vertical gap="small">
                          {!commandFields.length && (
                            <Empty
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                              description={t('quickCommandSetting.emptyCategory')}
                            />
                          )}
                          {commandFields.map((command) => (
                            <Flex key={command.key} gap="small" align="flex-start">
                              <Form.Item name={[command.name, 'id']} hidden>
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name={[command.name, 'title']}
                                style={{ width: 200, marginBottom: 0, flexShrink: 0 }}
                                rules={[
                                  {
                                    required: true,
                                    whitespace: true,
                                    message: t('quickCommandSetting.commandTitleRequired'),
                                  },
                                ]}
                              >
                                <Input
                                  placeholder={t('quickCommandSetting.commandTitlePlaceholder')}
                                />
                              </Form.Item>
                              <Form.Item
                                name={[command.name, 'content']}
                                style={{ flex: 1, marginBottom: 0 }}
                                rules={[
                                  {
                                    required: true,
                                    whitespace: true,
                                    message: t('quickCommandSetting.commandContentRequired'),
                                  },
                                ]}
                              >
                                <Input.TextArea
                                  autoSize={{ minRows: 2, maxRows: 8 }}
                                  placeholder={t('quickCommandSetting.commandContentPlaceholder')}
                                />
                              </Form.Item>
                              <Button
                                type="text"
                                aria-label={t('formAction.delete')}
                                icon={<MinusOutlined />}
                                onClick={() => removeCommand(command.name)}
                              />
                            </Flex>
                          ))}
                          <Button
                            type="dashed"
                            block
                            icon={<PlusOutlined />}
                            onClick={() => addCommand({ id: newId(), title: '', content: '' })}
                          >
                            {t('quickCommandSetting.addCommand')}
                          </Button>
                        </Flex>
                      )}
                    </Form.List>
                  </Card>
                );
              })}

              <Button
                block
                icon={<PlusOutlined />}
                onClick={() => add({ id: newId(), name: '', commands: [] })}
              >
                {t('quickCommandSetting.addCategory')}
              </Button>
            </Flex>
          )}
        </Form.List>

        <Form.Item style={{ textAlign: 'right', marginTop: 'var(--ant-margin)' }}>
          <Space>
            <Button type="primary" htmlType="submit">
              {t('formAction.save')}
            </Button>
            <Button htmlType="button" onClick={onRestoreDefault}>
              {t('quickCommandSetting.restoreDefault')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </section>
  );
};

export default QuickCommandSetting;
