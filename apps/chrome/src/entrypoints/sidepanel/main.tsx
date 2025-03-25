import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { theme } from 'antd';
import { XProvider } from '@ant-design/x';

import App from './App.tsx';

import store from '@/store';
import { useAppSelector } from '@/hooks/useStore.ts';
import '@/i18n';

import './main.less';

const { darkAlgorithm, defaultAlgorithm } = theme;

const Root = () => {
  const { isDarkMode } = useAppSelector((state) => state.app);
  return (
    <XProvider
      theme={{
        cssVar: true,
        hashed: false,
        algorithm: isDarkMode ? darkAlgorithm : defaultAlgorithm,
      }}
    >
      <App />
    </XProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  // 开发模式下会存在hooks重复调用的问题
  <React.StrictMode>
    <Provider store={store}>
      <Root />
    </Provider>
  </React.StrictMode>
);
