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
import type { EligibleCollaborator, TeamMember, TTeam } from '@/common/types/team/teamTypes';

const listMembersMock = vi.fn();
const listEligibleMock = vi.fn();
const addMemberMock = vi.fn();
const removeMemberMock = vi.fn();
const messageSuccessMock = vi.fn();
const messageErrorMock = vi.fn();
const modalConfirmMock = vi.fn();
const translationMock = vi.hoisted(() => ({
  t: (key: string, options?: { defaultValue?: string; name?: string }) => {
    if (options?.name) {
      return (options.defaultValue || key).replace('{{name}}', options.name);
    }
    return options?.defaultValue || key;
  },
  i18n: { language: 'en-US' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => translationMock,
}));

const mockUser = { id: 'owner-user-1' };
vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
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
    Modal: {
      ...actual.Modal,
      confirm: (config: { onOk?: () => Promise<void> | void }) => {
        modalConfirmMock(config);
        // Automatically execute onOk for testing
        return config.onOk?.();
      },
    },
  };
});

vi.mock('@renderer/components/base/AionModal', () => {
  type HeaderConfig = { title?: React.ReactNode; subtitle?: React.ReactNode };
  type FooterConfig = { render?: () => React.ReactNode };
  return {
    default: ({ visible, header, footer, children }: Record<string, unknown>) =>
      visible ? (
        <div data-testid='team-collaborators-modal'>
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
      listMembers: { invoke: (...args: unknown[]) => listMembersMock(...args) },
      listEligibleCollaborators: { invoke: (...args: unknown[]) => listEligibleMock(...args) },
      addMember: { invoke: (...args: unknown[]) => addMemberMock(...args) },
      removeMember: { invoke: (...args: unknown[]) => removeMemberMock(...args) },
    },
  },
}));

import TeamCollaboratorsModal from '@/renderer/pages/team/components/collaborators';

const sampleTeam: TTeam = {
  id: 'team-1',
  user_id: 'owner-user-1',
  name: 'Shared Family Project',
  workspace: '/workspace/family',
  workspace_mode: 'shared',
  sharing_mode: 'shared',
  current_member_role: 'owner',
  leader_assistant_id: 'lead-1',
  assistants: [],
  created_at: 1000,
  updated_at: 1000,
};

const sampleMembers: TeamMember[] = [
  {
    membership_ref: 'mem-owner',
    role: 'owner',
    display_name: 'Alice Owner',
    email: 'alice@example.com',
  },
  {
    membership_ref: 'mem-collab-1',
    role: 'collaborator',
    display_name: 'Bob Collab',
    email: 'bob@example.com',
  },
];

const sampleEligible: EligibleCollaborator[] = [
  {
    account_ref: 'acc-charlie',
    display_name: 'Charlie Partner',
    email: 'charlie@example.com',
  },
];

describe('TeamCollaboratorsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.id = 'owner-user-1';
    listMembersMock.mockResolvedValue(sampleMembers);
    listEligibleMock.mockResolvedValue(sampleEligible);
  });

  it('renders People / Collaborators management distinctly separated from AI agents', async () => {
    render(<TeamCollaboratorsModal visible onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith({ team_id: 'team-1' }));

    // Header emphasizes human collaboration distinct from AI roster
    expect(screen.getByText('People & Collaborators')).toBeInTheDocument();
    expect(
      screen.getByText(/Manage human collaborators who share this team\. AI assistants are managed separately/)
    ).toBeInTheDocument();

    // Renders active team members
    expect(screen.getByText('Alice Owner')).toBeInTheDocument();
    expect(screen.getByText('Bob Collab')).toBeInTheDocument();

    // Role tags
    expect(screen.getByTestId('team-collaborator-role-mem-owner')).toHaveTextContent('Owner');
    expect(screen.getByTestId('team-collaborator-role-mem-collab-1')).toHaveTextContent('Collaborator');

    // Security notice disclosure
    expect(screen.getByText('Execution & Security Notice')).toBeInTheDocument();
    expect(
      screen.getByText(/All runs execute under the Team Owner’s credentials and capabilities/)
    ).toBeInTheDocument();
  });

  it('allows Owner to remove a Collaborator but protects Owner from removal', async () => {
    removeMemberMock.mockResolvedValue(undefined);

    render(<TeamCollaboratorsModal visible onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => expect(screen.getByText('Bob Collab')).toBeInTheDocument());

    // Owner cannot be removed — no remove button
    expect(screen.queryByTestId('team-collaborator-remove-mem-owner')).not.toBeInTheDocument();

    // Collaborator has remove button
    const removeBtn = screen.getByTestId('team-collaborator-remove-mem-collab-1');
    expect(removeBtn).toBeInTheDocument();

    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(removeMemberMock).toHaveBeenCalledWith({
        team_id: 'team-1',
        membership_ref: 'mem-collab-1',
      });
    });

    expect(messageSuccessMock).toHaveBeenCalledWith('Collaborator removed successfully');
  });

  it('allows Owner to select and add an eligible account immediately', async () => {
    const newMember: TeamMember = {
      membership_ref: 'mem-charlie',
      account_ref: 'acc-charlie',
      role: 'collaborator',
      display_name: 'Charlie Partner',
      email: 'charlie@example.com',
    };
    addMemberMock.mockResolvedValue(newMember);

    render(<TeamCollaboratorsModal visible onClose={vi.fn()} team={sampleTeam} />);

    await waitFor(() => expect(listEligibleMock).toHaveBeenCalledTimes(1));

    // Picker is present for owner
    expect(screen.getByTestId('team-collaborator-picker')).toBeInTheDocument();
    const addBtn = screen.getByTestId('team-collaborator-add-btn');
    expect(addBtn).toBeDisabled();

    // Select Charlie
    const select = screen.getByTestId('team-collaborator-picker');
    fireEvent.change(select, { target: { value: 'acc-charlie' } });

    // Click Add
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(addMemberMock).toHaveBeenCalledWith({
        team_id: 'team-1',
        account_ref: 'acc-charlie',
      });
    });

    expect(messageSuccessMock).toHaveBeenCalledWith('Collaborator added successfully');
    await waitFor(() => expect(screen.getByText('Charlie Partner')).toBeInTheDocument());
  });

  it('renders read-only collaborator view when current user is not owner', async () => {
    const nonOwnerTeam: TTeam = {
      ...sampleTeam,
      user_id: 'another-user',
      current_member_role: 'collaborator',
    };
    mockUser.id = 'collaborator-user-2';

    render(<TeamCollaboratorsModal visible onClose={vi.fn()} team={nonOwnerTeam} />);

    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());

    // Does not call eligible accounts API
    expect(listEligibleMock).not.toHaveBeenCalled();

    // Shows owner-only notice
    expect(screen.getByText('Only the Team Owner can add or remove collaborators.')).toBeInTheDocument();

    // Add controls and remove buttons are not shown
    expect(screen.queryByTestId('team-collaborator-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-collaborator-add-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-collaborator-remove-mem-collab-1')).not.toBeInTheDocument();
  });
});
