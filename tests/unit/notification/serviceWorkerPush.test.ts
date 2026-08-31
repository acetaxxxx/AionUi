import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type WorkerEvent = {
  waitUntil: (promise: Promise<unknown>) => void;
  notification?: { data: unknown; close: () => void };
  data?: { json: () => unknown };
};

function loadWorker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const self = {
    location: { href: 'https://aion.test/sw.js', origin: 'https://aion.test' },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue(undefined),
    },
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) => listeners.set(name, handler),
  };
  runInNewContext(readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8'), {
    self,
    caches: {},
    URL,
    Response,
    Promise,
    Set,
    Object,
  });
  return { listeners, self, showNotification };
}

function event(): WorkerEvent & { promise: Promise<unknown> } {
  const result = {
    waitUntil: (next: Promise<unknown>) => {
      result.promise = next;
    },
    promise: Promise.resolve(),
  };
  return result;
}

describe('PWA service worker push notifications', () => {
  it('uses fixed templates and preserves an exact same-origin team hash route', async () => {
    const worker = loadWorker();
    const pushEvent = event();
    pushEvent.data = {
      json: () => ({
        schema_version: 1,
        status: 'success',
        title: 'attacker-controlled title',
        body: 'attacker-controlled body',
        target_kind: 'team',
        target_id: 'team_01',
      }),
    };

    worker.listeners.get('push')?.(pushEvent);
    await pushEvent.promise;

    expect(worker.showNotification).toHaveBeenCalledWith('Aion turn completed', {
      body: 'Your task has finished.',
      data: { schema_version: 1, target_kind: 'team', target_id: 'team_01' },
    });
  });

  it('focuses an existing same-origin client and navigates to the conversation hash route', async () => {
    const worker = loadWorker();
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    worker.self.clients.matchAll.mockResolvedValue([
      { url: 'https://aion.test/#/guid', focus, navigate },
      { url: 'https://other.test/#/guid', focus: vi.fn(), navigate: vi.fn() },
    ]);
    const close = vi.fn();
    const clickEvent = event();
    clickEvent.notification = {
      data: { schema_version: 1, target_kind: 'conversation', target_id: 'conversation-7' },
      close,
    };

    worker.listeners.get('notificationclick')?.(clickEvent);
    await clickEvent.promise;

    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('https://aion.test/#/conversation/conversation-7');
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('drops malformed or untrusted destinations without opening the application home', async () => {
    const worker = loadWorker();
    const pushEvent = event();
    pushEvent.data = {
      json: () => ({
        schema_version: 1,
        status: 'failed',
        target_kind: 'javascript',
        target_id: 'https://evil.test',
      }),
    };
    worker.listeners.get('push')?.(pushEvent);
    await pushEvent.promise;

    const clickEvent = event();
    clickEvent.notification = {
      data: { schema_version: 1, target_kind: 'team', target_id: '../home' },
      close: vi.fn(),
    };
    worker.listeners.get('notificationclick')?.(clickEvent);
    await clickEvent.promise;

    expect(worker.showNotification).not.toHaveBeenCalled();
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });
});
