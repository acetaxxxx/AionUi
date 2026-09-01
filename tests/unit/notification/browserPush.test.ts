import { describe, expect, it, vi } from 'vitest';
import {
  disableBrowserPush,
  enableBrowserPush,
  type BrowserPushSubscription,
} from '@/renderer/hooks/system/notification/browserPush';

const PUBLIC_VAPID_KEY = 'B'.repeat(87);

function subscription(): BrowserPushSubscription {
  return {
    endpoint: 'https://push.example/subscription-a',
    keys: {
      p256dh: 'public-key',
      auth: 'auth-key',
    },
  };
}

describe('enableBrowserPush', () => {
  it('only subscribes after an explicit granted permission and never sends user identity', async () => {
    const subscribe = vi.fn().mockResolvedValue(subscription());
    const upsert = vi.fn().mockResolvedValue({ id: 'push-1' });
    const store = vi.fn();

    const result = await enableBrowserPush({
      requestPermission: vi.fn().mockResolvedValue('granted'),
      loadConfig: vi.fn().mockResolvedValue({ enabled: true, publicVapidKey: PUBLIC_VAPID_KEY }),
      registerServiceWorker: vi.fn().mockResolvedValue({ pushManager: { subscribe } }),
      upsert,
      storeSubscriptionId: store,
    });

    expect(result).toEqual({ enabled: true, subscriptionId: 'push-1' });
    expect(upsert).toHaveBeenCalledWith(subscription());
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('user_id');
    expect(store).toHaveBeenCalledWith('push-1');
  });

  it('keeps PWA usable when permission is denied or VAPID is unavailable', async () => {
    const registerServiceWorker = vi.fn();
    const loadConfig = vi.fn().mockResolvedValue({ enabled: false, publicVapidKey: null });

    const denied = await enableBrowserPush({
      requestPermission: vi.fn().mockResolvedValue('denied'),
      loadConfig,
      registerServiceWorker,
      upsert: vi.fn(),
      storeSubscriptionId: vi.fn(),
    });
    const unavailable = await enableBrowserPush({
      requestPermission: vi.fn().mockResolvedValue('granted'),
      loadConfig,
      registerServiceWorker,
      upsert: vi.fn(),
      storeSubscriptionId: vi.fn(),
    });

    expect(denied.enabled).toBe(false);
    expect(unavailable.enabled).toBe(false);
    expect(registerServiceWorker).not.toHaveBeenCalled();
  });
});

describe('disableBrowserPush', () => {
  it('keeps the local reference when server deletion fails so cleanup can be retried', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const deleteSubscription = vi.fn().mockRejectedValue(new Error('session expired'));
    const clearSubscriptionId = vi.fn();

    await disableBrowserPush({
      subscriptionId: 'push-1',
      deleteSubscription,
      getRegistration: vi.fn().mockResolvedValue({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue({ unsubscribe }),
        },
      }),
      clearSubscriptionId,
    });

    expect(deleteSubscription).toHaveBeenCalledWith('push-1');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(clearSubscriptionId).not.toHaveBeenCalled();
  });

  it('does not block cleanup forever when the server request hangs', async () => {
    vi.useFakeTimers();
    try {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      const resultPromise = disableBrowserPush({
        subscriptionId: 'push-1',
        deleteSubscription: () => new Promise<void>(() => {}),
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({ unsubscribe }),
          },
        }),
        clearSubscriptionId: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(resultPromise).resolves.toEqual({ serverDeleted: false, browserUnsubscribed: true });
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
