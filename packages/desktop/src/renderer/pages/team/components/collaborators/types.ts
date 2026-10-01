/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamMember, TTeam } from '@/common/types/team/teamTypes';

export type TeamCollaboratorsModalProps = {
  visible: boolean;
  onClose: () => void;
  team: TTeam;
};

export type CollaboratorItemProps = {
  member: TeamMember;
  isOwner: boolean;
  isRemoving: boolean;
  onRemove: (member: TeamMember) => void;
};
