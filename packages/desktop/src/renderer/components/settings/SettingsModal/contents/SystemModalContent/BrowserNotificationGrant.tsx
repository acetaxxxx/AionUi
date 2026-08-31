/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpRequest } from '@/common/adapter/httpBridge';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import {
  enableBrowserPush,
  registerAionServiceWorker,
  storePushSubscriptionId,
} from '@/renderer/hooks/system/notification/browserPush';

/**
 * WebUI-only control to request browser notification permission. In Electron
 * this is never rendered (native notifications are used instead). Renders a
 * grant button, the granted/denied state, or a hint when the page is not a
 * secure context (HTTPS / localhost), where the Notification API is unavailable.
 */
const BrowserNotificationGrant: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const supported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext;
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleRequest = useCallback(async () => {
    if (!supported || !user || busy) return;
    setBusy(true);
    const result = await enableBrowserPush({
      requestPermission: () => Notification.requestPermission(),
      loadConfig: async () => {
        const config = await httpRequest<{ enabled: boolean; public_vapid_key?: string | null }>(
          'GET',
          '/api/push/config'
        );
        return {
          enabled: config.enabled,
          publicVapidKey: config.public_vapid_key ?? null,
        };
      },
      registerServiceWorker: async () => registerAionServiceWorker(),
      upsert: (subscription) =>
        httpRequest<{ id: string }>('PUT', '/api/push/subscription', {
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        }),
      storeSubscriptionId: (subscriptionId) => storePushSubscriptionId(user.id, subscriptionId),
    });
    setBusy(false);
    if (result.enabled) {
      setPermission('granted');
      setEnabled(true);
    } else if (result.reason === 'permission-denied') {
      setPermission('denied');
    }
  }, [busy, supported, user]);

  if (!supported) {
    return <div className='ps-12px text-12px text-3'>{t('settings.browserNotification.insecureContext')}</div>;
  }
  if (permission === 'granted' && enabled) {
    return <div className='ps-12px text-12px text-3'>{t('settings.browserNotification.granted')}</div>;
  }
  if (permission === 'denied') {
    return <div className='ps-12px text-12px text-3'>{t('settings.browserNotification.denied')}</div>;
  }
  return (
    <div className='ps-12px'>
      <Button type='outline' size='small' onClick={handleRequest}>
        {busy ? '…' : t('settings.browserNotification.enable')}
      </Button>
    </div>
  );
};

export default BrowserNotificationGrant;
