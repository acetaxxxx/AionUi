import { Button, Card, Message, Space, Tag, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import type { LiveViewControlPort, LiveViewScope, LiveViewSnapshot } from '@/renderer/services/facebookLiveViewControl';

const STATUS_LABELS: Record<LiveViewSnapshot['status'], string> = {
  ready: 'ready',
  auth_paused: 'auth-paused',
  checkpoint: 'checkpoint',
  captcha: 'CAPTCHA',
  profile_busy: 'ProfileBusy',
  session_ended: 'session ended',
};

export interface FacebookLiveViewControlProps {
  client: LiveViewControlPort;
  userId: string;
  conversationId: string;
  monitorId: string;
}

const FacebookLiveViewControl: React.FC<FacebookLiveViewControlProps> = ({
  userId,
  conversationId,
  monitorId,
  client,
}) => {
  const scope = { user_id: userId, conversation_id: conversationId, monitor_id: monitorId };
  const [snapshot, setSnapshot] = useState<LiveViewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await client.getStatus(scope));
    } catch {
      setSnapshot(null);
    }
  }, [client, userId, conversationId, monitorId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invoke = useCallback(
    async (operation: (scope: LiveViewScope) => Promise<LiveViewSnapshot>) => {
      setBusy(true);
      try {
        setSnapshot(await operation(scope));
      } catch {
        Message.error('LiveView is unavailable; no browser session was started.');
      } finally {
        setBusy(false);
      }
    },
    [client, userId, conversationId, monitorId]
  );

  const status = snapshot ? STATUS_LABELS[snapshot.status] : 'unavailable';
  return (
    <Card size='small' title='Facebook LiveView' data-testid='facebook-live-view-control'>
      <Space direction='vertical' style={{ width: '100%' }}>
        <Typography.Text>Status: {status}</Typography.Text>
        {snapshot?.detail && <Typography.Text type='secondary'>{snapshot.detail}</Typography.Text>}
        {snapshot?.approval_required && <Tag color='orange'>Approval required</Tag>}
        {snapshot?.next_scheduled_run_at && (
          <Typography.Text type='secondary'>
            Next scheduled run: {new Date(snapshot.next_scheduled_run_at).toLocaleString()}
          </Typography.Text>
        )}
        <Space>
          <Button disabled={busy} onClick={() => void invoke(client.start)}>
            Start Live View
          </Button>
          <Button disabled={busy} onClick={() => void invoke(client.reauthenticate)}>
            Reauthenticate
          </Button>
          <Button disabled={busy} onClick={() => void invoke(client.stop)}>
            End Live View
          </Button>
        </Space>
        <Typography.Text type='secondary'>
          Passwords, MFA seeds, and bearer tokens are never handled or stored by AionUI.
        </Typography.Text>
      </Space>
    </Card>
  );
};

export default FacebookLiveViewControl;
