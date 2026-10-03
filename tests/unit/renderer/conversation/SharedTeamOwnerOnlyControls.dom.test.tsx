/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpTerminalOutput, IMessageAsk } from '@/common/chat/chatLib';
import MessageAcpTerminalOutput from '@/renderer/pages/conversation/Messages/acp/MessageAcpTerminalOutput';
import MessageQuestion from '@/renderer/pages/conversation/Messages/MessageQuestion';
import SkillSuggestCard from '@/renderer/pages/conversation/Messages/components/SkillSuggestCard';

const {
  answerAsk,
  dismissArtifact,
  hasSkill,
  killTerminal,
  saveSkill,
  teamPermission,
  updateArtifactStatus,
} = vi.hoisted(() => ({
  answerAsk: vi.fn(),
  dismissArtifact: vi.fn(),
  hasSkill: vi.fn(),
  killTerminal: vi.fn(),
  saveSkill: vi.fn(),
  teamPermission: vi.fn(),
  updateArtifactStatus: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      killTerminal: { invoke: killTerminal },
      updateArtifact: { invoke: dismissArtifact },
    },
    cron: {
      hasSkill: { invoke: hasSkill },
      saveSkill: { invoke: saveSkill },
    },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    answerAsk: { invoke: answerAsk },
  },
}));

vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: () => teamPermission(),
}));

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  const RadioContext = ReactModule.createContext<{
    value?: string;
    onChange?: (value: string) => void;
  }>({});
  const Button = ({
    children,
    loading: _loading,
    size: _size,
    status: _status,
    type: _type,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    size?: string;
    status?: string;
    type?: string;
  }) => <button {...props}>{children}</button>;
  const Card = ({
    children,
    bordered: _bordered,
    size: _size,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { bordered?: boolean; size?: string }) => <div {...props}>{children}</div>;
  const RadioItem = ({
    children,
    value,
    'data-testid': testId,
  }: {
    children?: React.ReactNode;
    value: string;
    'data-testid'?: string;
  }) => {
    const group = ReactModule.useContext(RadioContext);
    return (
      <label>
        <input
          type='radio'
          checked={group.value === value}
          onChange={() => group.onChange?.(value)}
          data-testid={testId}
        />
        {children}
      </label>
    );
  };
  const RadioGroup = ({
    children,
    value,
    onChange,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { value?: string; onChange?: (value: string) => void }) => (
    <RadioContext.Provider value={{ value, onChange }}>
      <div {...props}>{children}</div>
    </RadioContext.Provider>
  );
  const Radio = Object.assign(RadioItem, { Group: RadioGroup });
  const CheckboxItem = ({
    children,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { children?: React.ReactNode }) => (
    <label>
      <input type='checkbox' {...props} />
      {children}
    </label>
  );
  const Checkbox = Object.assign(CheckboxItem, {
    Group: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  });
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />;
  const Tag = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;

  return {
    Button,
    Card,
    Checkbox,
    Input,
    Message: { error: vi.fn(), success: vi.fn() },
    Radio,
    Tag,
  };
});

vi.mock('@icon-park/react', () => ({
  CheckOne: () => null,
  Down: () => null,
  Lightning: () => null,
  Up: () => null,
}));

vi.mock('@renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@renderer/pages/conversation/Messages/artifacts', () => ({
  useUpdateConversationArtifactStatus: () => updateArtifactStatus,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const terminalMessage = {
  id: 'terminal-message',
  conversation_id: 'team-conversation',
  type: 'acp_terminal_output',
  content: { terminal_id: 'terminal-1', command: 'echo ok', output: 'ok' },
} as IMessageAcpTerminalOutput;

const askMessage = {
  id: 'ask-message',
  conversation_id: 'team-conversation',
  type: 'ask',
  content: {
    request_id: 'request-1',
    questions: [{ question: 'Which style?', options: [{ label: 'Tabs' }, { label: 'Spaces' }] }],
  },
} as unknown as IMessageAsk;

const skillSuggestion = {
  artifact_id: 'artifact-1',
  conversation_id: 'team-conversation',
  suggestion: { name: 'Suggested skill', description: 'Use a skill', content: '# Skill' },
  cron_job_id: 'job-1',
};

describe('Shared Team collaborator owner-only controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamPermission.mockReturnValue({ isOwner: false });
    answerAsk.mockResolvedValue(undefined);
    dismissArtifact.mockResolvedValue(undefined);
    hasSkill.mockResolvedValue(false);
    killTerminal.mockResolvedValue(undefined);
    saveSkill.mockResolvedValue(undefined);
  });

  it('does not expose terminal Stop to collaborators but keeps it for the owner', async () => {
    const { rerender } = render(<MessageAcpTerminalOutput message={terminalMessage} />);
    expect(screen.queryByTestId('terminal-card-stop')).not.toBeInTheDocument();
    expect(killTerminal).not.toHaveBeenCalled();

    teamPermission.mockReturnValue({ isOwner: true });
    rerender(<MessageAcpTerminalOutput message={terminalMessage} />);
    fireEvent.click(screen.getByTestId('terminal-card-stop'));
    await waitFor(() => expect(killTerminal).toHaveBeenCalledWith({
      conversation_id: 'team-conversation',
      terminal_id: 'terminal-1',
    }));
  });

  it('hides artifact dismissal from collaborators and retains owner dismissal', async () => {
    const { rerender } = render(<SkillSuggestCard {...skillSuggestion} />);
    expect(screen.queryByTestId('skill-suggest-dismiss')).not.toBeInTheDocument();
    expect(dismissArtifact).not.toHaveBeenCalled();

    teamPermission.mockReturnValue({ isOwner: true });
    rerender(<SkillSuggestCard {...skillSuggestion} />);
    fireEvent.click(screen.getByTestId('skill-suggest-dismiss'));
    await waitFor(() => expect(dismissArtifact).toHaveBeenCalledWith({
      conversation_id: 'team-conversation',
      artifact_id: 'artifact-1',
      status: 'dismissed',
    }));
  });

  it('shows AskUserQuestion without answer controls to collaborators and never invokes the generic answer route', () => {
    render(<MessageQuestion message={askMessage} />);

    expect(screen.getByTestId('message-question-owner-only')).toHaveTextContent(
      'team.collaborators.confirmationOwnerOnly'
    );
    expect(screen.queryByTestId('message-question-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-question-decline')).not.toBeInTheDocument();
    expect(answerAsk).not.toHaveBeenCalled();
  });

  it('preserves owner AskUserQuestion submit and decline behavior', async () => {
    teamPermission.mockReturnValue({ isOwner: true });
    const { unmount } = render(<MessageQuestion message={askMessage} />);
    fireEvent.click(screen.getByTestId('message-question-option-0-Tabs'));
    fireEvent.click(screen.getByTestId('message-question-submit'));
    await waitFor(() => expect(answerAsk).toHaveBeenCalledWith({
      conversation_id: 'team-conversation',
      request_id: 'request-1',
      answers: [{ question: 'Which style?', labels: ['Tabs'] }],
    }));
    unmount();

    answerAsk.mockClear();
    render(<MessageQuestion message={askMessage} />);
    fireEvent.click(screen.getByTestId('message-question-decline'));
    await waitFor(() => expect(answerAsk).toHaveBeenCalledWith({
      conversation_id: 'team-conversation',
      request_id: 'request-1',
      decline: true,
    }));
  });

  it('keeps standalone AskUserQuestion controls available outside Team context', () => {
    teamPermission.mockReturnValue(null);
    render(<MessageQuestion message={askMessage} />);

    expect(screen.queryByTestId('message-question-owner-only')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-question-submit')).toBeInTheDocument();
    expect(screen.getByTestId('message-question-decline')).toBeInTheDocument();
  });
});
