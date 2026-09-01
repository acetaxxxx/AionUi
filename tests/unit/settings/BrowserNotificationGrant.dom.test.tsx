/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const browserMocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', username: 'tester' } }),
}));
vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: browserMocks.httpRequest }));

import BrowserNotificationGrant from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserNotificationGrant';

function PushManager() {}

const setNotification = (permission: NotificationPermission | null, secure = true) => {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
  setPushSupport();
  if (permission === null) {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  } else {
    (globalThis as unknown as { Notification: unknown }).Notification = {
      permission,
      requestPermission: vi.fn(() => Promise.resolve('granted')),
    };
  }
};

const setPushSupport = () => {
  const registration = {
    pushManager: {
      subscribe: vi.fn().mockResolvedValue({
        endpoint: 'https://push.example/subscription-a',
        keys: { p256dh: 'browser-public-key', auth: 'browser-auth' },
      }),
      getSubscription: vi.fn().mockResolvedValue({ unsubscribe: browserMocks.unsubscribe }),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      register: vi.fn().mockResolvedValue(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
    configurable: true,
  });
  Object.defineProperty(window, 'PushManager', { value: PushManager, configurable: true });
};

beforeEach(() => {
  localStorage.clear();
  browserMocks.httpRequest
    .mockReset()
    .mockImplementation((method: string) =>
      Promise.resolve(method === 'GET' ? { enabled: false, public_vapid_key: null } : { id: 'push-1' })
    );
  browserMocks.unsubscribe.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('BrowserNotificationGrant', () => {
  it('shows the enable button when permission is default', () => {
    setNotification('default');
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.enable')).toBeInTheDocument();
  });

  it('shows the granted state when an existing browser subscription is present', async () => {
    setNotification('granted');
    localStorage.setItem('aion.push.subscription.id:user-1', 'push-1');
    render(<BrowserNotificationGrant />);
    await waitFor(() => expect(screen.getByText('settings.browserNotification.granted')).toBeInTheDocument());
  });

  it('shows the denied state when permission is denied', () => {
    setNotification('denied');
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.denied')).toBeInTheDocument();
  });

  it('shows the insecure-context hint when not a secure context', () => {
    setNotification('default', false);
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.insecureContext')).toBeInTheDocument();
  });

  it('requests permission when the enable button is clicked', async () => {
    setNotification('default');
    browserMocks.httpRequest.mockResolvedValue({ enabled: true, public_vapid_key: 'B'.repeat(87) });
    const requestSpy = (globalThis as unknown as { Notification: { requestPermission: ReturnType<typeof vi.fn> } })
      .Notification.requestPermission;
    render(<BrowserNotificationGrant />);
    await userEvent.click(screen.getByText('settings.browserNotification.enable'));
    expect(requestSpy).toHaveBeenCalled();
  });

  it('lets the user disable the current browser after Push is enabled', async () => {
    setNotification('default');
    browserMocks.httpRequest.mockImplementation((method: string) =>
      Promise.resolve(method === 'GET' ? { enabled: true, public_vapid_key: 'B'.repeat(87) } : { id: 'push-1' })
    );

    render(<BrowserNotificationGrant />);
    await userEvent.click(screen.getByText('settings.browserNotification.enable'));

    await waitFor(() => {
      expect(screen.getByText('settings.browserNotification.disable')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('settings.browserNotification.disable'));

    expect(browserMocks.httpRequest).toHaveBeenCalledWith('DELETE', '/api/push/subscription/push-1');
    expect(browserMocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps disable available when server deletion fails so it can be retried', async () => {
    setNotification('default');
    browserMocks.httpRequest.mockImplementation((method: string) => {
      if (method === 'GET') {
        return Promise.resolve({ enabled: true, public_vapid_key: 'B'.repeat(87) });
      }
      if (method === 'DELETE') {
        return Promise.reject(new Error('session expired'));
      }
      return Promise.resolve({ id: 'push-1' });
    });

    render(<BrowserNotificationGrant />);
    await userEvent.click(screen.getByText('settings.browserNotification.enable'));
    await waitFor(() => {
      expect(screen.getByText('settings.browserNotification.disable')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('settings.browserNotification.disable'));

    await waitFor(() => {
      expect(screen.getByText('settings.browserNotification.disableFailed')).toBeInTheDocument();
      expect(screen.getByText('settings.browserNotification.disable')).toBeInTheDocument();
    });
  });
});
