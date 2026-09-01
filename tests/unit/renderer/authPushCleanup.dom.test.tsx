import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const httpMocks = vi.hoisted(() => ({ httpRequest: vi.fn(), unsubscribe: vi.fn() }));

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: httpMocks.httpRequest }));

import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
});

const Probe = () => {
  const { status, refresh } = useAuth();
  return (
    <>
      <span>{status}</span>
      <button onClick={() => void refresh()}>refresh</button>
    </>
  );
};

beforeEach(() => {
  httpMocks.httpRequest.mockReset().mockResolvedValue(undefined);
  httpMocks.unsubscribe.mockReset().mockResolvedValue(true);
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistration: vi.fn().mockResolvedValue({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue({ unsubscribe: httpMocks.unsubscribe }),
        },
      }),
    },
    configurable: true,
  });
  localStorage.setItem('aion.push.subscription.id:user-1', 'push-1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AuthProvider browser Push cleanup', () => {
  it('cleans the previous user browser subscription before handling session expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { success: true, user: { id: 'user-1', username: 'tester' } }))
      .mockResolvedValueOnce(response(401, { success: false }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());
    await userEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());

    expect(httpMocks.httpRequest).toHaveBeenCalledWith('DELETE', '/api/push/subscription/push-1');
    expect(httpMocks.unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem('aion.push.subscription.id:user-1')).toBeNull();
  });
});
