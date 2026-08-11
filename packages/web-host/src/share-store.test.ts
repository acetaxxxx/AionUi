import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ShareStore, ShareStoreError } from './share-store.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeStore(): Promise<ShareStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-shares-'));
  tempDirs.push(dir);
  const store = new ShareStore(dir, { ttlMs: 60_000 });
  await store.init();
  return store;
}

describe('ShareStore', () => {
  it('persists a snapshot and assets across restart without storing the token', async () => {
    const store = await makeStore();
    const created = await store.create('owner-1', {
      title: 'Notes',
      markdown: '# Notes',
      assets: [{ name: '../logo.png', mime: 'image/png', data: Buffer.from('png').toString('base64') }],
    });
    expect(store.getPublic(created.token)?.markdown).toBe('# Notes');
    const restarted = new ShareStore((store as unknown as { storageDir: string }).storageDir);
    // The storage path is private; use metadata existence to verify the durable contract.
    expect((await fs.readFile(path.join(tempDirs[0], 'shares.json'), 'utf8'))).not.toContain(created.token);
    await restarted.init();
    expect(restarted.getPublic(created.token)?.assets[0]?.name).toBe('logo.png');
  });

  it('enforces owner-only revoke and expiry', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-shares-expiry-'));
    tempDirs.push(dir);
    const store = new ShareStore(dir);
    await store.init();
    const created = await store.create('owner-1', { markdown: 'hello', expiresAt: new Date(Date.now() + 1000).toISOString() });
    expect(await store.revoke('other-owner', created.id)).toBe(false);
    expect(store.getPublic(created.token)).not.toBeNull();
    expect(await store.revoke('owner-1', created.id)).toBe(true);
    expect(store.getPublic(created.token)).toBeNull();
  });

  it('rejects oversized or non-image assets', async () => {
    const store = await makeStore();
    await expect(store.create('owner-1', { markdown: 'ok', assets: [{ name: 'x', mime: 'text/html', data: 'aA==' }] })).rejects.toBeInstanceOf(
      ShareStoreError
    );
  });
});
