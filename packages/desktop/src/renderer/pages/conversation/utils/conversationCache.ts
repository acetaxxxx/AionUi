/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';

export function teamConversationCacheKey(team_id: string, conversation_id: string): [string, string, string] {
  return ['team-conversation', team_id, conversation_id];
}

export async function getTeamConversationOrNull(
  team_id: string,
  conversation_id: string
): Promise<TChatConversation | null> {
  try {
    return await ipcBridge.team.getConversation.invoke({ team_id, conversation_id });
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getConversationOrNull(
  conversation_id: string,
  options?: { team_id?: string }
): Promise<TChatConversation | null> {
  if (options?.team_id) {
    return getTeamConversationOrNull(options.team_id, conversation_id);
  }
  try {
    return await ipcBridge.conversation.get.invoke({ id: conversation_id });
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

export async function refreshTeamConversationCache(
  team_id: string,
  conversation_id: string
): Promise<void> {
  const conversation = await getTeamConversationOrNull(team_id, conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(teamConversationCacheKey(team_id, conversation_id), conversation, false);
}

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await getConversationOrNull(conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
