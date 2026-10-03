/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';
import {
  getConversationOrNull,
  getTeamConversationOrNull,
  refreshConversationCache,
  refreshTeamConversationCache,
  teamConversationCacheKey,
} from '@/renderer/pages/conversation/utils/conversationCache';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: {
        invoke: vi.fn(),
      },
    },
    team: {
      getConversation: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

const mockConversation = {
  id: 'conv-1',
  name: 'Test conversation',
  type: 'acp',
  status: 'finished',
  extra: {},
} as TChatConversation;

describe('conversationCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConversationOrNull', () => {
    it('returns null when the backend reports a missing conversation', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/missing',
        status: 404,
        body: {
          success: false,
          error: 'Not found: Conversation missing not found',
          code: 'NOT_FOUND',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(getConversationOrNull('missing')).resolves.toBeNull();
    });

    it('returns the conversation when the backend lookup succeeds', async () => {
      vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(mockConversation);

      await expect(getConversationOrNull('conv-1')).resolves.toBe(mockConversation);
    });

    it('rethrows non-404 backend errors so database failures remain visible', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal error: Database error: no such table: conversations',
          code: 'INTERNAL_ERROR',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(getConversationOrNull('conv-1')).rejects.toBe(error);
    });

    it('delegates to getTeamConversationOrNull when options.team_id is provided', async () => {
      vi.mocked(ipcBridge.team.getConversation.invoke).mockResolvedValue(mockConversation);

      const result = await getConversationOrNull('conv-1', { team_id: 'team-42' });
      expect(result).toBe(mockConversation);
      expect(ipcBridge.team.getConversation.invoke).toHaveBeenCalledWith({
        team_id: 'team-42',
        conversation_id: 'conv-1',
      });
      expect(ipcBridge.conversation.get.invoke).not.toHaveBeenCalled();
    });
  });

  describe('getTeamConversationOrNull', () => {
    it('returns null when the team conversation returns 404', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/teams/team-42/conversations/worker-1',
        status: 404,
        body: {
          success: false,
          error: 'Team team-42 not found',
        },
      });
      vi.mocked(ipcBridge.team.getConversation.invoke).mockRejectedValue(error);

      await expect(getTeamConversationOrNull('team-42', 'worker-1')).resolves.toBeNull();
    });

    it('returns conversation when lookup succeeds', async () => {
      vi.mocked(ipcBridge.team.getConversation.invoke).mockResolvedValue(mockConversation);

      await expect(getTeamConversationOrNull('team-42', 'lead-1')).resolves.toBe(mockConversation);
      expect(ipcBridge.team.getConversation.invoke).toHaveBeenCalledWith({
        team_id: 'team-42',
        conversation_id: 'lead-1',
      });
    });

    it('rethrows non-404 errors', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/teams/team-42/conversations/lead-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal server error',
        },
      });
      vi.mocked(ipcBridge.team.getConversation.invoke).mockRejectedValue(error);

      await expect(getTeamConversationOrNull('team-42', 'lead-1')).rejects.toBe(error);
    });
  });

  describe('teamConversationCacheKey', () => {
    it('constructs scoped cache key tuple', () => {
      expect(teamConversationCacheKey('team-1', 'conv-1')).toEqual(['team-conversation', 'team-1', 'conv-1']);
    });
  });

  describe('refreshTeamConversationCache', () => {
    it('mutates SWR cache with team key when conversation exists', async () => {
      vi.mocked(ipcBridge.team.getConversation.invoke).mockResolvedValue(mockConversation);

      await refreshTeamConversationCache('team-42', 'lead-1');

      expect(mutate).toHaveBeenCalledWith(['team-conversation', 'team-42', 'lead-1'], mockConversation, false);
    });

    it('skips mutate when conversation is missing (404)', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/teams/team-42/conversations/worker-1',
        status: 404,
        body: { success: false, error: 'Not found' },
      });
      vi.mocked(ipcBridge.team.getConversation.invoke).mockRejectedValue(error);

      await refreshTeamConversationCache('team-42', 'worker-1');

      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('refreshConversationCache', () => {
    it('skips cache mutation when the conversation is missing', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/missing',
        status: 404,
        body: {
          success: false,
          error: 'Not found: Conversation missing not found',
          code: 'NOT_FOUND',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(refreshConversationCache('missing')).resolves.toBeUndefined();

      expect(mutate).not.toHaveBeenCalled();
    });

    it('rethrows non-404 backend errors instead of hiding them', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal error: Database error: no such table: conversations',
          code: 'INTERNAL_ERROR',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(refreshConversationCache('conv-1')).rejects.toBe(error);

      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
