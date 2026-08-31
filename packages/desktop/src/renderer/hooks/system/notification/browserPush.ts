export type BrowserPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type BrowserPushConfig = {
  enabled: boolean;
  publicVapidKey: string | null;
};

type PushManagerLike = {
  subscribe: (options: { userVisibleOnly: true; applicationServerKey: Uint8Array }) => Promise<unknown>;
};

type ServiceWorkerRegistrationLike = {
  pushManager: PushManagerLike;
};

export type BrowserPushEnableResult =
  | { enabled: true; subscriptionId: string }
  | { enabled: false; reason: 'permission-denied' | 'unavailable' };

export type BrowserPushEnableDeps = {
  requestPermission: () => Promise<'default' | 'granted' | 'denied'>;
  loadConfig: () => Promise<BrowserPushConfig>;
  registerServiceWorker: () => Promise<ServiceWorkerRegistrationLike>;
  upsert: (subscription: BrowserPushSubscription) => Promise<{ id: string }>;
  storeSubscriptionId: (subscriptionId: string) => void;
};

export type BrowserPushDisableDeps = {
  subscriptionId: string | null;
  deleteSubscription: (subscriptionId: string) => Promise<void>;
  getRegistration: () => Promise<{
    pushManager: {
      getSubscription: () => Promise<{ unsubscribe: () => Promise<boolean> } | null>;
    };
  }>;
  clearSubscriptionId: () => void;
};

/**
 * Enables browser push from an explicit user gesture. All browser APIs and
 * network calls are injected so denied/unsupported browsers remain a normal
 * PWA state and the behavior can be tested without a real service worker.
 */
export async function enableBrowserPush(deps: BrowserPushEnableDeps): Promise<BrowserPushEnableResult> {
  try {
    const config = await deps.loadConfig();
    if (!config.enabled || !config.publicVapidKey) {
      return { enabled: false, reason: 'unavailable' };
    }

    if ((await deps.requestPermission()) !== 'granted') {
      return { enabled: false, reason: 'permission-denied' };
    }

    const registration = await deps.registerServiceWorker();
    const rawSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(config.publicVapidKey),
    });
    const subscription = normalizeSubscription(rawSubscription);
    const saved = await deps.upsert(subscription);
    deps.storeSubscriptionId(saved.id);
    return { enabled: true, subscriptionId: saved.id };
  } catch {
    return { enabled: false, reason: 'unavailable' };
  }
}

/** Best-effort removal used by the disable control and before logout. */
export async function disableBrowserPush(deps: BrowserPushDisableDeps): Promise<void> {
  try {
    if (deps.subscriptionId) {
      await deps.deleteSubscription(deps.subscriptionId);
    }
  } catch {
    // A logout must not be blocked by an unavailable backend. The browser
    // subscription is still unsubscribed and the local reference is removed.
  }

  try {
    const registration = await deps.getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Service-worker teardown is also best effort.
  } finally {
    deps.clearSubscriptionId();
  }
}

export function pushSubscriptionStorageKey(userId: string): string {
  return `aion.push.subscription.id:${userId}`;
}

export function readPushSubscriptionId(userId: string): string | null {
  try {
    return localStorage.getItem(pushSubscriptionStorageKey(userId));
  } catch {
    return null;
  }
}

export function storePushSubscriptionId(userId: string, subscriptionId: string): void {
  try {
    localStorage.setItem(pushSubscriptionStorageKey(userId), subscriptionId);
  } catch {
    // Storage may be unavailable in private browsing; server state remains
    // valid and the current session can still receive notifications.
  }
}

export function clearPushSubscriptionId(userId: string): void {
  try {
    localStorage.removeItem(pushSubscriptionStorageKey(userId));
  } catch {
    // Ignore storage teardown failures.
  }
}

export async function registerAionServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('service worker unavailable');
  }
  return navigator.serviceWorker.register('/sw.js');
}

export async function getAionServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('service worker unavailable');
  }
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    throw new Error('service worker not registered');
  }
  return registration;
}

function normalizeSubscription(value: unknown): BrowserPushSubscription {
  if (!value || typeof value !== 'object') {
    throw new Error('missing push subscription');
  }

  const candidate = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    toJSON?: () => unknown;
  };
  const json = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate;
  if (!json || typeof json !== 'object') {
    throw new Error('invalid push subscription');
  }

  const serialized = json as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (
    typeof serialized.endpoint !== 'string' ||
    !serialized.endpoint ||
    typeof serialized.keys?.p256dh !== 'string' ||
    !serialized.keys.p256dh ||
    typeof serialized.keys.auth !== 'string' ||
    !serialized.keys.auth
  ) {
    throw new Error('invalid push subscription');
  }

  return {
    endpoint: serialized.endpoint,
    keys: {
      p256dh: serialized.keys.p256dh,
      auth: serialized.keys.auth,
    },
  };
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
