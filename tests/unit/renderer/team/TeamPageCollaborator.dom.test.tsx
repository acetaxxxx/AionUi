/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';

const {
  getTeamConversationMock,
  getConversationMock,
  ensureSessionMock,
  teamSendMessageMock,
  teamEventHandlers,
  makeTeamEventChannel,
  layoutState,
} = vi.hoisted(() => {
  const handlers: Record<string, Array<(event: unknown) => void>> = {};
  const makeChannel = (name: string) => ({
    on: vi.fn((handler: (event: unknown) => void) => {
      handlers[name] = [...(handlers[name] ?? []), handler];
      return vi.fn();
    }),
  });
  return {
    getTeamConversationMock: vi.fn(),
    getConversationMock: vi.fn(),
    ensureSessionMock: vi.fn(async () => undefined),
    teamSendMessageMock: vi.fn(async () => ({ run_id: 'test-run-1' })),
    teamEventHandlers: handlers,
    makeTeamEventChannel: makeChannel,
    layoutState: { isMobile: false },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      useMessage: () => [null, null],
    },
    Modal: Object.assign(actual.Modal, { confirm: vi.fn() }),
  };
});

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'collab-user-1' } }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => layoutState,
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      get: { invoke: vi.fn() },
      getConversation: { invoke: (...args: unknown[]) => getTeamConversationMock(...args) },
      renameTeam: { invoke: vi.fn() },
      addAgent: { invoke: vi.fn() },
      removeAgent: { invoke: vi.fn() },
      attachAgent: { invoke: vi.fn(async () => undefined) },
      resetAgentContext: { invoke: vi.fn() },
      pauseSlotWork: { invoke: vi.fn() },
      getRunState: { invoke: vi.fn(async () => ({ session_generation: null, active_run: null, slot_work: [] })) },
      activeLease: { invoke: vi.fn(async () => ({ renewed_count: 2 })) },
      ensureSession: { invoke: (...args: unknown[]) => ensureSessionMock(...args) },
      sendMessage: { invoke: (...args: unknown[]) => teamSendMessageMock(...args) },
      sendMessageToAgent: { invoke: vi.fn(async () => ({ run_id: 'test-run-1' })) },
      setSessionMode: { invoke: vi.fn(async () => undefined) },
      getConfigOptions: { invoke: vi.fn(async () => ({ options: [] })) },
      setConfigOption: { invoke: vi.fn(async () => undefined) },
      agentStatusChanged: makeTeamEventChannel('agentStatusChanged'),
      agentSpawned: makeTeamEventChannel('agentSpawned'),
      agentRemoved: makeTeamEventChannel('agentRemoved'),
      agentRenamed: makeTeamEventChannel('agentRenamed'),
      agentRuntimeStatusChanged: makeTeamEventChannel('agentRuntimeStatusChanged'),
      sessionStatusChanged: makeTeamEventChannel('sessionStatusChanged'),
      taskChanged: makeTeamEventChannel('taskChanged'),
      sessionChanged: makeTeamEventChannel('sessionChanged'),
      runAccepted: makeTeamEventChannel('runAccepted'),
      runStarted: makeTeamEventChannel('runStarted'),
      runUpdated: makeTeamEventChannel('runUpdated'),
      runCompleted: makeTeamEventChannel('runCompleted'),
      runCancelled: makeTeamEventChannel('runCancelled'),
      runFailed: makeTeamEventChannel('runFailed'),
      childTurnStarted: makeTeamEventChannel('childTurnStarted'),
      childTurnCompleted: makeTeamEventChannel('childTurnCompleted'),
      childTurnCancelled: makeTeamEventChannel('childTurnCancelled'),
      slotWorkChanged: makeTeamEventChannel('slotWorkChanged'),
      listChanged: makeTeamEventChannel('listChanged'),
    },
    cron: { removeJob: { invoke: vi.fn() } },
    assistant: { list: { invoke: vi.fn(async () => []) } },
    conversation: {
      get: { invoke: (...args: unknown[]) => getConversationMock(...args) },
      update: { invoke: vi.fn(async () => undefined) },
      listChanged: makeTeamEventChannel('conversationListChanged'),
      confirmation: {
        list: { invoke: vi.fn(async () => []) },
        add: makeTeamEventChannel('confirmationAdd'),
        remove: makeTeamEventChannel('confirmationRemove'),
      },
    },
    realtime: { reconnected: makeTeamEventChannel('reconnected') },
  },
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout', () => ({
  __esModule: true,
  default: ({ children, tabsSlot }: { children: React.ReactNode; tabsSlot?: React.ReactNode }) => (
    <div>
      <div data-testid='team-tabs-slot'>{tabsSlot}</div>
      <div data-testid='team-chat-layout'>{children}</div>
    </div>
  ),
}));

vi.mock('@/renderer/components/agent/AcpModelSelector', () => ({
  __esModule: true,
  default: (props: { conversation_id: string }) => <div data-testid={`acp-model-selector-${props.conversation_id}`} />,
}));

vi.mock('@/renderer/components/agent/AcpRuntimeRestartButton', () => ({
  __esModule: true,
  useAcpRuntimeRestart: () => ({ restart: vi.fn(), restarting: false }),
  default: (props: { conversation_id: string }) => <div data-testid={`runtime-restart-${props.conversation_id}`} />,
}));

vi.mock('@/renderer/pages/team/components/TeamAgentActions', () => ({
  __esModule: true,
  default: () => <div data-testid='team-agent-actions' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-aionrs-model-selector' />,
}));

const acpChatMock = vi.fn(
  (props: {
    conversation_id: string;
    team_id?: string;
    hideSendBox?: boolean;
    teamSendMessage?: (payload: { input: string; files: [] }) => Promise<void>;
  }) => (
    <div
      data-testid={`acp-chat-${props.conversation_id}`}
      data-team-id={props.team_id}
      data-has-send={Boolean(props.teamSendMessage)}
    >
      {!props.hideSendBox && (
        <button
          data-testid={`acp-send-btn-${props.conversation_id}`}
          onClick={() => props.teamSendMessage?.({ input: 'test lead input', files: [] })}
        >
          Send
        </button>
      )}
    </div>
  )
);

const aionrsChatMock = vi.fn(
  (props: {
    conversation_id: string;
    team_id?: string;
    teamSendMessage?: (payload: { input: string; files: [] }) => Promise<void>;
  }) => <div data-testid={`aionrs-chat-${props.conversation_id}`} data-team-id={props.team_id} />
);

vi.mock('@/renderer/pages/conversation/platforms/acp/AcpChat', () => ({
  __esModule: true,
  default: (props: unknown) => acpChatMock(props as any),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  __esModule: true,
  default: (props: unknown) => aionrsChatMock(props as any),
}));

vi.mock('@renderer/pages/conversation/components/ChatSlider.tsx', () => ({
  __esModule: true,
  default: ({ conversation: c }: { conversation: TChatConversation }) => (
    <div data-testid={`team-chat-slider-${c.id}`} />
  ),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobManager: () => <div data-testid='mock-cron' />,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: () => {}, closePreviewIfScopeChanged: () => {} }),
}));

import TeamPage from '@/renderer/pages/team/TeamPage';

function makeTeam(overrides?: Partial<TTeam>): TTeam {
  return {
    id: 'team-collab-1',
    user_id: 'owner-user-1',
    role: 'collaborator',
    sharing_mode: 'shared',
    name: 'Collaborator Team',
    workspace: '/tmp/team',
    workspace_mode: 'shared',
    leader_assistant_id: 'leader-assistant',
    created_at: 1,
    updated_at: 1,
    assistants: [
      {
        slot_id: 'slot-lead',
        conversation_id: 'conv-lead',
        role: 'leader',
        assistant_backend: 'claude',
        assistant_name: 'Lead Agent',
        status: 'idle',
        context_reset: { supported: false, availability: 'leader_not_targetable' },
      },
      {
        slot_id: 'slot-worker',
        conversation_id: 'conv-worker',
        role: 'teammate',
        assistant_backend: 'claude',
        assistant_name: 'Worker Agent',
        status: 'idle',
        context_reset: { supported: true, availability: 'ready' },
      },
    ],
    ...overrides,
  };
}

function makeConversation(id: string): TChatConversation {
  return {
    id,
    type: 'acp',
    name: `Conversation ${id}`,
    created_at: 1,
    updated_at: 1,
    extra: {
      backend: 'claude',
      workspace: '/tmp/team',
    },
  } as TChatConversation;
}

describe('TeamPage collaborator view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureSessionMock.mockResolvedValue(undefined);
    layoutState.isMobile = false;
    for (const key of Object.keys(teamEventHandlers)) delete teamEventHandlers[key];
    localStorage.clear();
  });

  it('collaborator Lead chat sends through Team API and hides worker pane', async () => {
    getTeamConversationMock.mockImplementation(
      async ({ conversation_id }: { team_id: string; conversation_id: string }) => {
        if (conversation_id === 'conv-lead') {
          return makeConversation('conv-lead');
        }
        throw new Error('Unauthorized');
      }
    );

    render(
      <MemoryRouter>
        <TeamPage team={makeTeam()} />
      </MemoryRouter>
    );

    // 1. Lead conversation is fetched via ipcBridge.team.getConversation
    await waitFor(() => {
      expect(getTeamConversationMock).toHaveBeenCalledWith({
        team_id: 'team-collab-1',
        conversation_id: 'conv-lead',
      });
    });

    // 2. Worker conversation is never fetched from either conversation adapter.
    expect(getTeamConversationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-worker' })
    );
    expect(getConversationMock).not.toHaveBeenCalled();

    // 3. The Lead chat receives the Team ID and exposes the composer.
    expect(await screen.findByTestId('acp-chat-conv-lead')).toBeInTheDocument();
    expect(screen.getByTestId('acp-chat-conv-lead')).toHaveAttribute('data-team-id', 'team-collab-1');
    expect(screen.getByTestId('acp-send-btn-conv-lead')).toBeInTheDocument();

    // 4. Executing send invokes ipcBridge.team.sendMessage with team_id
    await act(async () => {
      screen.getByTestId('acp-send-btn-conv-lead').click();
    });
    expect(teamSendMessageMock).toHaveBeenCalledWith({
      team_id: 'team-collab-1',
      input: 'test lead input',
      files: [],
    });

    // 5. Worker slot renders intentional non-chat placeholder
    expect(screen.getByTestId('team-worker-inaccessible-slot-worker')).toBeInTheDocument();
    expect(screen.queryByTestId('acp-chat-conv-worker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-send-btn-conv-worker')).not.toBeInTheDocument();

    // 6. Non-owner collaborator does NOT render model selectors or restart controls
    expect(screen.queryByTestId('acp-model-selector-conv-lead')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runtime-restart-conv-lead')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-model-selector-conv-worker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-agent-actions')).not.toBeInTheDocument();
  });

  it('owner mounts both lead and worker conversations via team-scoped adapter and renders owner controls', async () => {
    const ownerTeamId = 'team-owner-1';
    getTeamConversationMock.mockImplementation(async ({ conversation_id }: { conversation_id: string }) =>
      makeConversation(conversation_id)
    );

    render(
      <MemoryRouter>
        <TeamPage team={makeTeam({ id: ownerTeamId, role: 'owner' })} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getTeamConversationMock).toHaveBeenCalledWith({
        team_id: ownerTeamId,
        conversation_id: 'conv-lead',
      });
      expect(getTeamConversationMock).toHaveBeenCalledWith({
        team_id: ownerTeamId,
        conversation_id: 'conv-worker',
      });
    });

    expect(await screen.findByTestId('acp-chat-conv-lead')).toBeInTheDocument();
    expect(await screen.findByTestId('acp-chat-conv-worker')).toBeInTheDocument();
    expect(screen.queryByTestId('team-worker-inaccessible-slot-worker')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-model-selector-conv-lead')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-restart-conv-lead')).toBeInTheDocument();
    expect(screen.getByTestId('acp-model-selector-conv-worker')).toBeInTheDocument();
  });
});
