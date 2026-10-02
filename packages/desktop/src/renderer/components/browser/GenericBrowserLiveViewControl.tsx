import { Button, Card, Image, Message, Select, Space, Tag, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import type {
  BrowserLiveViewSnapshot,
  BrowserProfile,
  BrowserScope,
  GenericBrowserControlPort,
} from '@/renderer/services/genericBrowserControl';

const STATUS_LABELS: Record<BrowserLiveViewSnapshot['status'], string> = {
  ready: 'ready',
  user_takeover: 'user takeover',
  auth_paused: 'authentication paused',
  checkpoint: 'checkpoint',
  captcha: 'CAPTCHA',
  profile_busy: 'ProfileBusy',
  session_ended: 'session ended',
  disconnected: 'disconnected',
  transport_unavailable: 'transport unavailable',
};

export interface GenericBrowserLiveViewControlProps {
  client: GenericBrowserControlPort;
  userId: string;
  conversationId: string;
  taskId: string;
  profiles: BrowserProfile[];
  allowedOrigins: string[];
}

const GenericBrowserLiveViewControl: React.FC<GenericBrowserLiveViewControlProps> = ({
  client,
  userId,
  conversationId,
  taskId,
  profiles,
  allowedOrigins,
}) => {
  const [profileId, setProfileId] = useState(profiles[0]?.profile_id ?? '');
  const [snapshot, setSnapshot] = useState<BrowserLiveViewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const scope: BrowserScope = {
    user_id: userId,
    conversation_id: conversationId,
    task_id: taskId,
    profile_id: profileId,
    allowed_origins: allowedOrigins,
  };
  const selected = profiles.find((profile) => profile.profile_id === profileId);

  useEffect(() => {
    if (profileId)
      void client
        .getStatus(scope)
        .then(setSnapshot)
        .catch(() => setSnapshot(null));
  }, [client, profileId, userId, conversationId, taskId, allowedOrigins]);

  const invoke = useCallback(
    async (operation: (scope: BrowserScope) => Promise<BrowserLiveViewSnapshot>) => {
      setBusy(true);
      try {
        setSnapshot(await operation(scope));
      } catch {
        Message.error('Browser transport unavailable; no browser action was started.');
      } finally {
        setBusy(false);
      }
    },
    [scope]
  );

  const terminal = !snapshot || ['session_ended', 'disconnected', 'transport_unavailable'].includes(snapshot.status);
  return (
    <Card size='small' title='Controlled Browser LiveView' data-testid='generic-browser-live-view'>
      <Space direction='vertical' style={{ width: '100%' }}>
        <Select
          value={profileId}
          onChange={setProfileId}
          placeholder='Select browser profile'
          data-testid='browser-profile-picker'
        >
          {profiles.map((profile) => (
            <Select.Option key={profile.profile_id} value={profile.profile_id}>
              {profile.account_label} · {profile.domain_scope} · {profile.auth_status}
            </Select.Option>
          ))}
        </Select>
        {selected && (
          <Typography.Text type='secondary'>
            Last used: {selected.last_used_at ?? 'never'} · scope: {selected.domain_scope}
          </Typography.Text>
        )}
        <Typography.Text>Status: {snapshot ? STATUS_LABELS[snapshot.status] : 'unavailable'}</Typography.Text>
        {snapshot?.detail && <Typography.Text type='secondary'>{snapshot.detail}</Typography.Text>}
        {snapshot?.approval_required && <Tag color='orange'>Approval required</Tag>}
        {snapshot?.next_scheduled_run_at && (
          <Typography.Text type='secondary'>
            Next scheduled run: {new Date(snapshot.next_scheduled_run_at).toLocaleString()}
          </Typography.Text>
        )}
        {snapshot?.frame && (
          <Image
            src={`data:image/${snapshot.frame.encoding};base64,${snapshot.frame.data}`}
            alt='Live browser view'
            preview={false}
            width='100%'
          />
        )}
        <Space wrap>
          <Button disabled={busy || !profileId} onClick={() => void invoke(client.start)}>
            Start / pre-login
          </Button>
          <Button disabled={busy || terminal} onClick={() => void invoke(client.pauseForUser)}>
            Take over
          </Button>
          <Button disabled={busy || terminal} onClick={() => void invoke(client.resumeAgent)}>
            Resume agent
          </Button>
          <Button disabled={busy || terminal} onClick={() => void invoke(client.renew)}>
            Renew
          </Button>
          <Button disabled={busy || terminal} onClick={() => void invoke(client.end)}>
            End
          </Button>
          <Button status='danger' disabled={busy || terminal} onClick={() => void invoke(client.revoke)}>
            Revoke
          </Button>
          <Button
            status='danger'
            disabled={busy || !profileId}
            onClick={() =>
              void client.deleteProfile({ user_id: userId, conversation_id: conversationId, profile_id: profileId })
            }
          >
            Delete profile
          </Button>
        </Space>
        <Typography.Text type='secondary'>
          Credentials, MFA seeds, bearer tokens, raw DOM, OCR and comments are never stored or shown to the agent.
        </Typography.Text>
      </Space>
    </Card>
  );
};

export default GenericBrowserLiveViewControl;
