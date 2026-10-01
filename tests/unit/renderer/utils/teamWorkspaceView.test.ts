import { describe, expect, it } from 'vitest';
import { resolveTeamWorkspaceView } from '@/renderer/pages/team/utils/teamWorkspaceView';

describe('resolveTeamWorkspaceView', () => {
  it('prefers teams.workspace over leader fallback', () => {
    const view = resolveTeamWorkspaceView('/project/app', '/tmp/leader');
    expect(view.workspacePath).toBe('/project/app');
    expect(view.workspaceEnabled).toBe(true);
    expect(view.isTemporaryWorkspace).toBe(false);
  });

  it('uses leader workspace only as display fallback for legacy empty teams.workspace', () => {
    const view = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader');
    expect(view.workspacePath).toBe('/tmp/aion/conversations/acp-temp-leader');
    expect(view.workspaceEnabled).toBe(true);
    expect(view.isTemporaryWorkspace).toBe(true);
  });

  it('marks Team-scoped temp workspace as temporary even when teams.workspace is non-empty', () => {
    const view = resolveTeamWorkspaceView('/tmp/aion/conversations/team-temp-team123', '');
    expect(view.workspacePath).toBe('/tmp/aion/conversations/team-temp-team123');
    expect(view.workspaceEnabled).toBe(true);
    expect(view.isTemporaryWorkspace).toBe(true);
  });

  it('marks per-conversation temp workspace as temporary for compatibility display', () => {
    const view = resolveTeamWorkspaceView('/tmp/aion/conversations/acp-temp-conv123', '');
    expect(view.isTemporaryWorkspace).toBe(true);
  });

  it('does not fall back to leader workspace for shared team when team.workspace is empty', () => {
    const viewWithOptions = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader', { isShared: true });
    expect(viewWithOptions.workspacePath).toBe('');
    expect(viewWithOptions.workspaceEnabled).toBe(false);
    expect(viewWithOptions.isTemporaryWorkspace).toBe(true);

    const viewWithMode = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader', { sharingMode: 'shared' });
    expect(viewWithMode.workspacePath).toBe('');
    expect(viewWithMode.workspaceEnabled).toBe(false);

    const viewWithBoolean = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader', true);
    expect(viewWithBoolean.workspacePath).toBe('');
    expect(viewWithBoolean.workspaceEnabled).toBe(false);
  });

  it('uses team.workspace for shared team when explicitly configured', () => {
    const view = resolveTeamWorkspaceView('/data/shared-workspace', '/tmp/aion/conversations/acp-temp-leader', {
      isShared: true,
    });
    expect(view.workspacePath).toBe('/data/shared-workspace');
    expect(view.workspaceEnabled).toBe(true);
    expect(view.isTemporaryWorkspace).toBe(false);
  });

  it('maintains leader workspace fallback for private teams when team.workspace is empty', () => {
    const viewDefault = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader');
    expect(viewDefault.workspacePath).toBe('/tmp/aion/conversations/acp-temp-leader');
    expect(viewDefault.workspaceEnabled).toBe(true);
    expect(viewDefault.isTemporaryWorkspace).toBe(true);

    const viewExplicitFalse = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader', {
      isShared: false,
    });
    expect(viewExplicitFalse.workspacePath).toBe('/tmp/aion/conversations/acp-temp-leader');
    expect(viewExplicitFalse.workspaceEnabled).toBe(true);

    const viewPrivateMode = resolveTeamWorkspaceView('', '/tmp/aion/conversations/acp-temp-leader', {
      sharingMode: 'private',
    });
    expect(viewPrivateMode.workspacePath).toBe('/tmp/aion/conversations/acp-temp-leader');
    expect(viewPrivateMode.workspaceEnabled).toBe(true);
  });
});
