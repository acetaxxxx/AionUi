/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTeam } from '@/common/types/team/teamTypes';

const getMcpAllowlistMock = vi.fn();
const setMcpAllowlistMock = vi.fn();
const listServersMock = vi.fn();
const messageSuccessMock = vi.fn();
const messageErrorMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      ...actual.Message,
      success: (...args: unknown[]) => messageSuccessMock(...args),
      error: (...args: unknown[]) => messageErrorMock(...args),
    },
  };
});

vi.mock('@renderer/components/base/AionModal', () => {
  type HeaderConfig = { title?: React.ReactNode; subtitle?: React.ReactNode };
  type FooterConfig = { render?: () => React.ReactNode };
  return {
    default: ({ visible, header, footer, children }: Record<string, unknown>) =>
      visible ? (
        <div data-testid='team-mcp-modal-wrapper'>
          {header && typeof header === 'object' && (
            <div data-testid='modal-header'>
              <h2>{(header as HeaderConfig).title}</h2>
              <p>{(header as HeaderConfig).subtitle}</p>
            </div>
          )}
          <div>{children as React.ReactNode}</div>
          {footer && typeof footer === 'object' && (footer as FooterConfig).render && (
            <div>{(footer as FooterConfig).render!()}</div>
          )}
        </div>
      ) : null,
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      getMcpAllowlist: { invoke: (...args: unknown[]) => getMcpAllowlistMock(...args) },
      setMcpAllowlist: { invoke: (...args: unknown[]) => setMcpAllowlistMock(...args) },
    },
    mcpService: {
      listServers: { invoke: (...args: unknown[]) => listServersMock(...args) },
    },
  },
}));

import TeamMcpAllowlistModal from '@/renderer/pages/team/mcp';

const sampleTeam: TTeam = {
  id: 'team-123',
  user_id: 'owner-user-1',
  name: 'Platform Engineering',
  workspace: '/workspace/teams/team-123',
  workspace_mode: 'shared',
  sharing_mode: 'shared',
  current_member_role: 'owner',
  leader_assistant_id: 'assistant-lead',
  assistants: [],
  created_at: 1000,
  updated_at: 1000,
};

describe('TeamMcpAllowlistModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMcpAllowlistMock.mockResolvedValue({ mcp_server_ids: ['mcp-server-1'] });
    setMcpAllowlistMock.mockResolvedValue(undefined);
    listServersMock.mockResolvedValue([
      {
        id: 'mcp-server-1',
        name: 'GitHub MCP',
        description: 'Read and query GitHub repositories',
        builtin: false,
        transport: 'stdio',
        original_json: '{"apiKey":"secret-token","url":"https://api.github.com"}',
      },
      {
        id: 'mcp-server-2',
        name: 'Database Explorer',
        description: 'Inspect Postgres database',
        builtin: false,
        transport: 'sse',
        original_json: '{"password":"super-secret-password"}',
      },
    ]);
  });

  it('displays clear security disclosure regarding Owner credentials and collaborator access', async () => {
    render(<TeamMcpAllowlistModal visible={true} onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-mcp-disclosure')).toBeInTheDocument();
    });

    const disclosure = screen.getByTestId('team-mcp-disclosure');
    expect(disclosure.textContent).toContain('Team Owner credentials');
    expect(disclosure.textContent).toContain('can be invoked by Team members');
    expect(disclosure.textContent).toContain('Unselected personal MCP servers remain unavailable');
    expect(disclosure.textContent).toContain('No collaborator credentials are used');
  });

  it('safely renders server labels and descriptions while omitting connection secrets, URLs, and configurations', async () => {
    render(<TeamMcpAllowlistModal visible={true} onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => {
      expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
      expect(screen.getByText('Database Explorer')).toBeInTheDocument();
    });

    expect(screen.getByText('Read and query GitHub repositories')).toBeInTheDocument();
    expect(screen.getByText('Inspect Postgres database')).toBeInTheDocument();

    const modalContent = screen.getByTestId('team-mcp-allowlist-modal').innerHTML;
    expect(modalContent).not.toContain('secret-token');
    expect(modalContent).not.toContain('super-secret-password');
    expect(modalContent).not.toContain('https://api.github.com');
  });

  it('loads initial allowlist and toggles servers', async () => {
    render(<TeamMcpAllowlistModal visible={true} onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-mcp-item-mcp-server-1')).toBeInTheDocument();
    });

    const checkbox1 = screen.getByTestId('team-mcp-checkbox-mcp-server-1').querySelector('input');
    const checkbox2 = screen.getByTestId('team-mcp-checkbox-mcp-server-2').querySelector('input');

    expect(checkbox1).toBeChecked();
    expect(checkbox2).not.toBeChecked();

    // Toggle server 2
    fireEvent.click(screen.getByTestId('team-mcp-item-mcp-server-2'));
    expect(checkbox2).toBeChecked();

    // Save
    fireEvent.click(screen.getByTestId('team-mcp-save-button'));

    await waitFor(() => {
      expect(setMcpAllowlistMock).toHaveBeenCalledWith({
        team_id: 'team-123',
        mcp_server_ids: ['mcp-server-1', 'mcp-server-2'],
      });
    });
  });

  it('allows saving an empty allowlist [] as a valid fail-closed configuration', async () => {
    render(<TeamMcpAllowlistModal visible={true} onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-mcp-item-mcp-server-1')).toBeInTheDocument();
    });

    // Uncheck server 1
    fireEvent.click(screen.getByTestId('team-mcp-item-mcp-server-1'));

    const checkbox1 = screen.getByTestId('team-mcp-checkbox-mcp-server-1').querySelector('input');
    expect(checkbox1).not.toBeChecked();

    // Save button should still be enabled
    const saveBtn = screen.getByTestId('team-mcp-save-button');
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(setMcpAllowlistMock).toHaveBeenCalledWith({
        team_id: 'team-123',
        mcp_server_ids: [],
      });
    });
  });

  it('renders empty notice when owner has no configured personal MCP servers', async () => {
    listServersMock.mockResolvedValue([]);
    getMcpAllowlistMock.mockResolvedValue({ mcp_server_ids: [] });

    render(<TeamMcpAllowlistModal visible={true} onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-mcp-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByTestId('team-mcp-empty-state').textContent).toContain('No personal MCP servers configured yet');
  });

  it('handles save error and does not silently succeed', async () => {
    setMcpAllowlistMock.mockRejectedValue(new Error('Network error'));
    const onClose = vi.fn();

    render(<TeamMcpAllowlistModal visible={true} onClose={onClose} team={sampleTeam} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-mcp-save-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('team-mcp-save-button'));

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalled();
    });

    // Modal should NOT have called onClose on failure
    expect(onClose).not.toHaveBeenCalled();
  });
});
