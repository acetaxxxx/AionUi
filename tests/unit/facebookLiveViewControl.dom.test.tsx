import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FacebookLiveViewControl from '@/renderer/components/facebook/FacebookLiveViewControl';
import type { LiveViewControlPort, LiveViewSnapshot } from '@/renderer/services/facebookLiveViewControl';

const snapshot: LiveViewSnapshot = {
  user_id: 'user-1',
  conversation_id: 'conversation-1',
  monitor_id: 'monitor-1',
  status: 'checkpoint',
  detail: 'Facebook requires confirmation before monitoring can continue.',
  approval_required: true,
  next_scheduled_run_at: 1788417000000,
  transport: 'planned',
};

function port(): LiveViewControlPort {
  return {
    getStatus: vi.fn().mockResolvedValue(snapshot),
    start: vi.fn().mockResolvedValue(snapshot),
    stop: vi.fn().mockResolvedValue({ ...snapshot, status: 'session_ended' }),
    reauthenticate: vi.fn().mockResolvedValue(snapshot),
    renew: vi.fn().mockResolvedValue(snapshot),
    revoke: vi.fn().mockResolvedValue({ ...snapshot, status: 'session_ended' }),
  };
}

describe('FacebookLiveViewControl', () => {
  it('shows checkpoint and approval/next-run guidance at the public UI seam', async () => {
    render(
      <FacebookLiveViewControl userId='user-1' conversationId='conversation-1' monitorId='monitor-1' client={port()} />
    );

    expect(await screen.findByText(/checkpoint/i)).toBeInTheDocument();
    expect(screen.getByText(/approval required/i)).toBeInTheDocument();
    expect(screen.getByText(/next scheduled run/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start live view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reauthenticate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end live view/i })).toBeInTheDocument();
  });
});
