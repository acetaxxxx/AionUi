import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GenericBrowserLiveViewControl from '@/renderer/components/browser/GenericBrowserLiveViewControl';
import type { GenericBrowserControlPort } from '@/renderer/services/genericBrowserControl';

const scope = {
  user_id: 'usr_1',
  conversation_id: 'conv_1',
  task_id: 'task_1',
  profile_id: 'profile_1',
  allowed_origins: ['https://example.com'],
};
const snapshot = {
  ...scope,
  status: 'checkpoint' as const,
  approval_required: true,
  transport: 'cookie_scoped' as const,
  detail: 'Complete authentication in LiveView.',
};

function client(): GenericBrowserControlPort {
  return {
    listProfiles: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(snapshot),
    start: vi.fn().mockResolvedValue(snapshot),
    renew: vi.fn().mockResolvedValue(snapshot),
    end: vi.fn().mockResolvedValue({ ...snapshot, status: 'session_ended' }),
    revoke: vi.fn().mockResolvedValue({ ...snapshot, status: 'session_ended' }),
    pauseForUser: vi.fn().mockResolvedValue({ ...snapshot, status: 'user_takeover' }),
    resumeAgent: vi.fn().mockResolvedValue(snapshot),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
  };
}

describe('GenericBrowserLiveViewControl', () => {
  it('exposes scoped profile and fail-closed takeover controls', async () => {
    render(
      <GenericBrowserLiveViewControl
        client={client()}
        userId='usr_1'
        conversationId='conv_1'
        taskId='task_1'
        allowedOrigins={scope.allowed_origins}
        profiles={[
          {
            profile_id: 'profile_1',
            account_label: 'Work account',
            domain_scope: 'example.com',
            auth_status: 'needs_reauth',
            last_used_at: 'never',
          },
        ]}
      />
    );
    expect(await screen.findByText(/checkpoint/i)).toBeInTheDocument();
    expect(screen.getByText(/approval required/i)).toBeInTheDocument();
    expect(screen.getByText(/work account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /take over/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume agent/i })).toBeInTheDocument();
    expect(screen.getByText(/credentials, MFA seeds/i)).toBeInTheDocument();
  });
});
