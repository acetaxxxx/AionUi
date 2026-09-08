import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeCloudflareAccessAndReturnToLogin } from '@/common/adapter/cloudflareLogout';

describe('Cloudflare logout recovery', () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('revokes with same-origin credentials before returning to login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await revokeCloudflareAccessAndReturnToLogin();

    expect(fetchMock).toHaveBeenCalledWith('/cdn-cgi/access/logout', {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
    });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('returns to login when the revoke request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    await revokeCloudflareAccessAndReturnToLogin();

    expect(assign).toHaveBeenCalledWith('/login');
  });
});
