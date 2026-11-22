import { useSyncExternalStore } from 'react';
import { Alert, Button, Collapse, Space } from 'antd';
import { useTranslation } from 'react-i18next';

import { decideToolApproval, getPendingToolApproval, subscribeToolApproval } from '../../../mcp/approval';

const ToolApprovalCard: React.FC = () => {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(
    subscribeToolApproval,
    getPendingToolApproval,
    getPendingToolApproval
  );
  if (!pending) return null;
  const params = JSON.stringify(pending.args ?? {}, null, 2);
  return (
    <Alert
      type="warning"
      showIcon
      message={`${pending.displayName}${pending.serverName ? ` · ${pending.serverName}` : ''}`}
      description={
        <Space direction="vertical" style={{ width: '100%' }}>
          <Collapse
            bordered={false}
            items={[
              {
                key: 'params',
                label: t('chat.toolParams'),
                children: <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{params}</pre>,
              },
            ]}
          />
          <Space>
            <Button size="small" type="primary" onClick={() => decideToolApproval('once')}>
              {t('chat.toolAllowOnce')}
            </Button>
            <Button size="small" onClick={() => decideToolApproval('session')}>
              {t('chat.toolAllowSession')}
            </Button>
            <Button size="small" danger onClick={() => decideToolApproval('reject')}>
              {t('chat.toolReject')}
            </Button>
          </Space>
        </Space>
      }
    />
  );
};

export default ToolApprovalCard;
