/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpBridgeMocks = vi.hoisted(() => {
  const provider = () => () => ({ provider: vi.fn(), invoke: vi.fn(async () => undefined) });
  const emitter = () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() });

  return {
    httpRequest: vi.fn(),
    httpGet: provider(),
    httpPost: provider(),
    httpPut: provider(),
    httpPatch: provider(),
    httpDelete: provider(),
    stubProvider: provider(),
    withResponseMap: vi.fn((inner: unknown) => inner),
    wsEmitter: vi.fn(emitter),
    wsMappedEmitter: vi.fn(emitter),
    stubEmitter: vi.fn(emitter),
  };
});

vi.mock('@/common/adapter/httpBridge', () => httpBridgeMocks);

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() })),
  },
}));

describe('ipcBridge image-base64 adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.httpRequest.mockReset();
  });

  it('does not retry a denied image through the general local-file content endpoint', async () => {
    httpBridgeMocks.httpRequest.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const { fs } = await import('@/common/adapter/ipcBridge');

    await expect(
      fs.getImageBase64.invoke({ path: '/data/private/photo.jpg', workspace: '/data/private' })
    ).resolves.toBeNull();

    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledTimes(1);
    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledWith(
      'POST',
      '/api/fs/image-base64',
      { path: '/data/private/photo.jpg', workspace: '/data/private' },
      undefined
    );
  });

  it('forwards an abort signal to the image request', async () => {
    httpBridgeMocks.httpRequest.mockResolvedValue('data:image/jpeg;base64,abc');
    const { fs } = await import('@/common/adapter/ipcBridge');
    const controller = new AbortController();
    const params = { path: '/data/photo.jpg', workspace: '/data' };

    await expect(fs.getImageBase64.invoke(params, { signal: controller.signal })).resolves.toBe(
      'data:image/jpeg;base64,abc'
    );

    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledWith('POST', '/api/fs/image-base64', params, {
      signal: controller.signal,
    });
  });
});
