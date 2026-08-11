import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackendSessionAuthenticator, startStaticServer, type StaticServerHandle } from './static-server.js';
import { ShareStore } from './share-store.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const request = (port: number, pathname: string, options: { method?: string; host: string; body?: string }) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: options.method ?? 'GET',
        headers: { Host: options.host, Connection: 'close', 'Content-Type': 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 500, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
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
    await expect(authenticate({ headers: { cookie: 'aionui-session=test' } } as IncomingMessage)).resolves.toBe(
      'user-from-backend'
    );
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

    const createdResponse = await request(handle.port, '/api/shares/markdown', {
      method: 'POST',
      host: 'app.example.test',
      body: JSON.stringify({
        markdown: '# Shared\n\n![logo](logo.png)',
        assets: [{ name: 'logo.png', mime: 'image/png', data: Buffer.from('png').toString('base64') }],
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = JSON.parse(createdResponse.text) as { token: string };

    const wrongHost = await request(handle.port, `/s/${created.token}`, { host: 'app.example.test' });
    expect(wrongHost.status).toBe(404);
    const publicResponse = await request(handle.port, `/s/${created.token}`, { host: 'share.snoozydoggy.com' });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers['content-type']).toContain('text/html');
    expect(publicResponse.headers['content-security-policy']).toContain("script-src 'self'");
    expect(publicResponse.headers['content-security-policy']).toContain("object-src 'none'");
    expect(publicResponse.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(publicResponse.headers['referrer-policy']).toBe('no-referrer');
    expect(publicResponse.text).toContain('compiled-share');
    const publicApiResponse = await request(handle.port, `/api/public/shares/${created.token}`, {
      host: 'share.snoozydoggy.com',
    });
    expect(publicApiResponse.status).toBe(200);
    expect(publicApiResponse.headers['content-security-policy']).toContain("connect-src 'self'");
    const publicData = JSON.parse(publicApiResponse.text) as { markdown: string; assets: Array<{ id: string }> };
    expect(publicData.markdown).toContain('# Shared');
    const assetResponse = await request(handle.port, `/api/public/shares/${created.token}/assets/${publicData.assets[0].id}`, {
      host: 'share.snoozydoggy.com',
    });
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(assetResponse.headers['cache-control']).toContain('immutable');
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
    const response = await request(handle.port, '/api/shares/markdown', {
      method: 'POST',
      host: 'app.example.test',
      body: JSON.stringify({ markdown: '# Blocked' }),
    });
    expect(response.status).toBe(401);
  });

  it('returns 503 when the compiled public entry is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-share-server-entry-'));
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-share-storage-entry-'));
    await fs.writeFile(path.join(root, 'index.html'), '<title>app</title>');
    const store = new ShareStore(storage);
    await store.init();
    const created = await store.create('owner-1', { markdown: '# Missing entry' });
    const backend = http.createServer((_req, res) => res.end('backend'));
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()));
    const handle = await startStaticServer({
      staticDir: root,
      backendPort: (backend.address() as { port: number }).port,
      port: 0,
      shareStorageDir: storage,
      sharePublicHost: 'share.snoozydoggy.com',
    });
    cleanups.push(async () => {
      await handle.stop();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storage, { recursive: true, force: true });
    });
    const response = await request(handle.port, `/s/${created.token}`, { host: 'share.snoozydoggy.com' });
    expect(response.status).toBe(503);
    expect((JSON.parse(response.text) as { error: string }).error).toBe('PUBLIC_SHARE_ENTRY_UNAVAILABLE');
  });
});
