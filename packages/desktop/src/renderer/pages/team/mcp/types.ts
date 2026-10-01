/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TTeam } from '@/common/types/team/teamTypes';

export type TeamMcpAllowlistModalProps = {
  visible: boolean;
  onClose: () => void;
  team: TTeam;
};

export type SafeMcpServerItem = {
  id: string;
  name: string;
  description?: string;
};
