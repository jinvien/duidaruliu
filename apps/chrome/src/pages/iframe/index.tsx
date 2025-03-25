import React, { CSSProperties } from 'react';
import { RollbackIcon } from 'tdesign-icons-react';
import { Flex } from 'antd';
import type { SetAppMode } from '@/entrypoints/sidepanel/App';

const StyleIframeTopBar: CSSProperties = {
  backgroundColor: 'var(--ant-color-primary)',
  color: 'var(--ant-color-white)',
  cursor: 'pointer',
  padding: 'var(--ant-padding-xxs) var(--ant-padding)',
};

const StyleIframe: CSSProperties = {
  width: '100%',
  flex: 1,
  border: 'none',
  margin: 0,
  padding: 0,
  overflow: 'hidden',
};

const IframePage: React.FC<{ setAppMode: SetAppMode; url: string }> = ({ setAppMode, url }) => {
  return (
    <Flex style={{ height: '100%' }} vertical>
      <Flex
        style={StyleIframeTopBar}
        align="center"
        justify="space-between"
        onClick={() => setAppMode('chat')}
      >
        <RollbackIcon />
        <span
          style={{
            fontSize: 'var(--ant-font-size-sm)',
          }}
        >
          {url}
        </span>
      </Flex>
      <iframe src={url} style={StyleIframe} />
    </Flex>
  );
};

export default IframePage;
