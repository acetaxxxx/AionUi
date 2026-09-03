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
  it('uses the bounded backend title and body for an exact same-origin team hash route', async () => {
    const worker = loadWorker();
    const pushEvent = event();
    pushEvent.data = {
      json: () => ({
        schema_version: 1,
        status: 'success',
        title: 'Aion 任務已完成：部署',
        body: '「部署」已完成。',
        target_kind: 'team',
        target_id: 'team_01',
      }),
    };

    worker.listeners.get('push')?.(pushEvent);
    await pushEvent.promise;

    expect(worker.showNotification).toHaveBeenCalledWith('Aion 任務已完成：部署', {
      body: '「部署」已完成。',
      data: { schema_version: 1, target_kind: 'team', target_id: 'team_01' },
    });
  });

  it('falls back to safe Traditional Chinese copy when payload text is invalid', async () => {
    const worker = loadWorker();
    const pushEvent = event();
    pushEvent.data = {
      json: () => ({
        schema_version: 1,
        status: 'failed',
        title: 'invalid\ntitle',
        body: 'invalid\tbody',
        target_kind: 'conversation',
        target_id: 'conversation-7',
      }),
    };

    worker.listeners.get('push')?.(pushEvent);
    await pushEvent.promise;

    expect(worker.showNotification).toHaveBeenCalledWith('Aion 任務需要處理', {
      body: '這項任務執行失敗，請查看詳情。',
      data: { schema_version: 1, target_kind: 'conversation', target_id: 'conversation-7' },
    });
  });

  it.each([
    ['URL', 'https://evil.test/private', 'visit api.evil.test/private'],
    ['token', 'token=secret-value', 'Bearer abcdefghijklmnop'],
    ['secret key', 'sk-abcdefghijklmnopqrstuvwxyz012345', 'safe-looking body'],
    ['oversized copy', '標'.repeat(31), '文'.repeat(51)],
  ])('fails closed when payload copy contains %s content', async (_case, title, body) => {
    const worker = loadWorker();
    const pushEvent = event();
    pushEvent.data = {
      json: () => ({
        schema_version: 1,
        status: 'failed',
        title,
        body,
        target_kind: 'conversation',
        target_id: 'conversation-7',
      }),
    };

    worker.listeners.get('push')?.(pushEvent);
    await pushEvent.promise;

    expect(worker.showNotification).toHaveBeenCalledWith('Aion 任務需要處理', {
      body: '這項任務執行失敗，請查看詳情。',
      data: { schema_version: 1, target_kind: 'conversation', target_id: 'conversation-7' },
    });
  });

  it('focuses an existing same-origin client and navigates to the conversation hash route', async () => {
    const worker = loadWorker();
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue({ url: 'https://aion.test/#/conversation/conversation-7' });
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

  it('opens a fresh window when focusing an existing client fails', async () => {
    const worker = loadWorker();
    const focus = vi.fn().mockRejectedValue(new Error('focus failed'));
    const navigate = vi.fn();
    worker.self.clients.matchAll.mockResolvedValue([
      { url: 'https://aion.test/#/guid', focus, navigate },
    ]);
    const clickEvent = event();
    clickEvent.notification = {
      data: { schema_version: 1, target_kind: 'team', target_id: 'team_01' },
      close: vi.fn(),
    };

    worker.listeners.get('notificationclick')?.(clickEvent);
    await clickEvent.promise;

    expect(navigate).not.toHaveBeenCalled();
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('https://aion.test/#/team/team_01');
  });

  it('opens a fresh window when navigating an existing client returns null', async () => {
    const worker = loadWorker();
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(null);
    worker.self.clients.matchAll.mockResolvedValue([
      { url: 'https://aion.test/#/guid', focus, navigate },
    ]);
    const clickEvent = event();
    clickEvent.notification = {
      data: { schema_version: 1, target_kind: 'conversation', target_id: 'conversation-7' },
      close: vi.fn(),
    };

    worker.listeners.get('notificationclick')?.(clickEvent);
    await clickEvent.promise;

    expect(navigate).toHaveBeenCalledWith('https://aion.test/#/conversation/conversation-7');
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith(
      'https://aion.test/#/conversation/conversation-7'
    );
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
