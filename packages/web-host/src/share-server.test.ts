import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackendSessionAuthenticator, startStaticServer, type StaticServerHandle } from './static-server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('share routes', () => {
  it('resolves the default authenticator from the backend session endpoint', async () => {
    const backend = http.createServer((req, res) => {
      expect(req.url).toBe('/api/auth/user');
      expect(req.headers.cookie).toBe('aionui-session=test');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, user: { id: 'user-from-backend' } }));
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()));
    cleanups.push(async () => new Promise<void>((resolve) => backend.close(() => resolve())));
    const authenticate = createBackendSessionAuthenticator((backend.address() as { port: number }).port);
    await expect(authenticate({ headers: { cookie: 'aionui-session=test' } } as IncomingMessage)).resolves.toBe('user-from-backend');
  });

  it('creates on an authenticated app host and reads only on the configured public host', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-share-server-'));
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-share-storage-'));
    const staticDir = path.join(root, 'static');
    await fs.mkdir(staticDir);
    await fs.writeFile(path.join(staticDir, 'index.html'), '<title>app</title>');
    await fs.writeFile(path.join(staticDir, 'share.html'), '<!doctype html><title>compiled-share</title>');
    const backend = http.createServer((_req, res) => res.end('backend'));
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()));
    const backendPort = (backend.address() as { port: number }).port;
    const handle: StaticServerHandle = await startStaticServer({
      staticDir,
      backendPort,
      port: 0,
      shareStorageDir: storage,
      sharePublicHost: 'share.snoozydoggy.com',
      authenticateShareUser: () => 'user-1',
    });
    cleanups.push(async () => {
      await handle.stop();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storage, { recursive: true, force: true });
    });

    const createdResponse = await fetch(`${handle.localUrl}/api/shares/markdown`, {
      method: 'POST',
      headers: { host: 'app.example.test', connection: 'close', 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: '# Shared' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { token: string };

    const wrongHost = await fetch(`${handle.localUrl}/s/${created.token}`, { headers: { host: 'app.example.test', connection: 'close' } });
    expect(wrongHost.status).toBe(404);
    const publicResponse = await fetch(`${handle.localUrl}/s/${created.token}`, {
      headers: { host: 'share.snoozydoggy.com', connection: 'close' },
    });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('content-type')).toContain('text/html');
    expect(await publicResponse.text()).toContain('compiled-share');
    const publicApiResponse = await fetch(`${handle.localUrl}/api/public/shares/${created.token}`, {
      headers: { host: 'share.snoozydoggy.com', connection: 'close' },
    });
    expect(publicApiResponse.status).toBe(200);
    expect((await publicApiResponse.json()).markdown).toBe('# Shared');
  });

  it('denies management APIs without an injected authenticator', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-share-server-auth-'));
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-share-storage-auth-'));
    await fs.writeFile(path.join(root, 'index.html'), '<title>app</title>');
    const backend = http.createServer((_req, res) => res.end('backend'));
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()));
    const handle = await startStaticServer({
      staticDir: root,
      backendPort: (backend.address() as { port: number }).port,
      port: 0,
      shareStorageDir: storage,
    });
    cleanups.push(async () => {
      await handle.stop();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storage, { recursive: true, force: true });
    });
    const response = await fetch(`${handle.localUrl}/api/shares/markdown`, {
      method: 'POST',
      headers: { host: 'app.example.test', connection: 'close', 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: '# Blocked' }),
    });
    expect(response.status).toBe(401);
  });
});
