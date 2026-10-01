export type TeamWorkspaceView = {
  workspacePath: string;
  workspaceEnabled: boolean;
  isTemporaryWorkspace: boolean;
};

const TEMP_WORKSPACE_PATTERN = /(?:^|[/\\])conversations[/\\](?:team-temp-|[^/\\]+-temp-)[^/\\]*$/;

function cleanWorkspace(value?: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isTemporaryTeamWorkspacePath(workspacePath: string): boolean {
  return TEMP_WORKSPACE_PATTERN.test(workspacePath);
}

export type ResolveTeamWorkspaceOptions = {
  isShared?: boolean;
  sharingMode?: 'private' | 'shared' | string;
};

export function resolveTeamWorkspaceView(
  teamWorkspace?: string,
  leaderWorkspace?: string,
  options?: ResolveTeamWorkspaceOptions | boolean
): TeamWorkspaceView {
  const isShared = typeof options === 'boolean'
    ? options
    : Boolean(options?.isShared ?? (options?.sharingMode === 'shared'));
  const normalizedTeamWorkspace = cleanWorkspace(teamWorkspace);
  const normalizedLeaderWorkspace = isShared ? '' : cleanWorkspace(leaderWorkspace);
  const workspacePath = normalizedTeamWorkspace || normalizedLeaderWorkspace;
  return {
    workspacePath,
    workspaceEnabled: workspacePath.length > 0,
    isTemporaryWorkspace: !normalizedTeamWorkspace || isTemporaryTeamWorkspacePath(normalizedTeamWorkspace),
  };
}
