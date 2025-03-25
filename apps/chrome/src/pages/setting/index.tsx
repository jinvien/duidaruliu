import { useState } from 'react';
import { Layout, Menu } from 'antd';
import { useTranslation } from 'react-i18next';

import OllamaSetting from './components/ollama';
import CustomLink from './components/customLink';
import CustomPrompt from './components/customPrompt';

import Styles from './index.module.less';
import type { MenuProps } from 'antd';

type MenuItem = Required<MenuProps>['items'][number];

const { Sider, Content } = Layout;

const OptionsPage: React.FC = () => {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState('ollamaSetting');

  function getItem(label: React.ReactNode, key: React.Key): MenuItem {
    return {
      key,
      label,
    } as MenuItem;
  }

  const items: MenuItem[] = [
    getItem(t('settingMenu.ollamaSetting'), 'ollamaSetting'),
    getItem(t('settingMenu.customPromptSetting'), 'customPrompt'),
    getItem(t('settingMenu.customLinkSetting'), 'customLink'),
  ];

  return (
    <Layout className={Styles.layout}>
      <Sider className={Styles.sider}>
        <Menu
          defaultSelectedKeys={[currentPage]}
          mode="inline"
          items={items}
          onClick={(selected) => {
            setCurrentPage(selected.key as string);
          }}
        />
      </Sider>
      <Layout>
        <Content className={Styles.content}>
          {currentPage === 'ollamaSetting' && <OllamaSetting />}
          {currentPage === 'customLink' && <CustomLink />}
          {currentPage === 'customPrompt' && <CustomPrompt />}
        </Content>
      </Layout>
    </Layout>
  );
};

export default OptionsPage;
