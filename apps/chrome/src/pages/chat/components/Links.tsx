import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { SYNC_VALUE_CHANGED } from '@/constants/command';
import type { SetAppMode } from '@/entrypoints/sidepanel/App';

const StyleLinksWrap = {
  padding: 'var(--ant-padding-sm)',
  fontSize: 'var(--ant-font-size-sm)',
};

const Links: React.FC<{ setAppMode: SetAppMode }> = ({ setAppMode }) => {
  const { t } = useTranslation();
  const [links, setLinks] = useState([]);

  const fetchCustomLink = async () => {
    const { customLinks } = await chrome.storage.sync.get('customLinks');
    setLinks(customLinks);
  };
  //  监听 chrome sync 配置更新事件
  const handleStorageChange = (bgMessage: { type: string; key: string; payload: any }) => {
    const { type, key, payload } = bgMessage;
    if (type !== SYNC_VALUE_CHANGED || key !== 'customLinks') {
      return;
    }

    setLinks(payload);
  };

  useEffect(() => {
    fetchCustomLink();

    chrome.runtime.onMessage.addListener(handleStorageChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStorageChange);
    };
  }, []);

  return links.length ? (
    <section style={StyleLinksWrap}>
      {t('links.shortCut')}
      {links.map(({ title, url }, i) => (
        <a
          key={i}
          onClick={() => setAppMode(url)}
          style={{
            color: 'var(--ant-color-text-description)',
            margin: '0 var(--ant-padding-xxs)',
          }}
        >
          {title}
        </a>
      ))}
    </section>
  ) : null;
};

export default Links;
