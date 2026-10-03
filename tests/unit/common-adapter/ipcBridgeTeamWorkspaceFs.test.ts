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

describe('ipcBridge Team workspace filesystem adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.httpRequest.mockReset();
  });

  it('reads collaborator preview content only through the membership-authorized fs content route', async () => {
    httpBridgeMocks.httpRequest.mockResolvedValue({ content: '# Team file' });
    const { fs } = await import('@/common/adapter/ipcBridge');
    const params = {
      file: { kind: 'local' as const, path: '/data/teams/team-1/README.md' },
      encoding: 'utf8' as const,
    };

    await expect(fs.readTeamWorkspaceContent.invoke(params)).resolves.toBe('# Team file');
    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledTimes(1);
    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledWith('POST', '/api/fs/content', params);
  });

  it('does not retry a denied Team content read through the general fs read route', async () => {
    httpBridgeMocks.httpRequest.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    const { fs } = await import('@/common/adapter/ipcBridge');

    await expect(
      fs.readTeamWorkspaceContent.invoke({
        file: { kind: 'local', path: '/data/teams/team-1/README.md' },
        encoding: 'utf8',
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledTimes(1);
  });
});
