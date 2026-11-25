import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { getChatHost, storageGet } from '../../../host';
import type { SetAppMode } from '../../../shell/types';

const StyleLinksWrap = {
  padding: 'var(--ant-padding-sm)',
  fontSize: 'var(--ant-font-size-sm)',
};

function asLinks(value: unknown): { title: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { title: string; url: string } =>
      !!item &&
      typeof item === 'object' &&
      typeof item.title === 'string' &&
      typeof item.url === 'string',
  );
}

const Links: React.FC<{ setAppMode: SetAppMode }> = ({ setAppMode }) => {
  const { t } = useTranslation();
  const [links, setLinks] = useState<{ title: string; url: string }[]>([]);

  useEffect(() => {
    let cancel = false;
    void storageGet('sync', 'customLinks').then(({ customLinks }) => {
      if (!cancel) setLinks(asLinks(customLinks));
    });
    const unsubscribe = getChatHost().storage.subscribe((changes, area) => {
      if (area !== 'sync' || !changes.customLinks) return;
      setLinks(asLinks(changes.customLinks.newValue));
    });
    return () => {
      cancel = true;
      unsubscribe();
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
