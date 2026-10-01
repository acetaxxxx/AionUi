/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { SafeMcpServerItem } from './types';

export function useTeamMcpAllowlist(team: TTeam, visible: boolean) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [servers, setServers] = useState<SafeMcpServerItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    if (!team.id) return;
    setLoading(true);
    try {
      const [allowlistRes, mcpServers] = await Promise.all([
        ipcBridge.team.getMcpAllowlist.invoke({ team_id: team.id }),
        ipcBridge.mcpService.listServers.invoke(),
      ]);

      const safeServers: SafeMcpServerItem[] = (mcpServers || [])
        .filter((s) => Boolean(s.id && !s.builtin))
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        }));

      setServers(safeServers);
      setSelectedIds(allowlistRes?.mcp_server_ids ?? []);
    } catch (err) {
      console.error('Failed to load MCP allowlist or servers:', err);
      Message.error(t('team.mcp.loadFailed', { defaultValue: 'Failed to load MCP servers' }));
    } finally {
      setLoading(false);
    }
  }, [team.id, t]);

  useEffect(() => {
    if (visible) {
      void fetchData();
    }
  }, [visible, fetchData]);

  const toggleServer = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const handleSave = useCallback(
    async (onSuccess?: () => void) => {
      setSaving(true);
      try {
        await ipcBridge.team.setMcpAllowlist.invoke({
          team_id: team.id,
          mcp_server_ids: selectedIds,
        });
        Message.success(t('team.mcp.saveSuccess', { defaultValue: 'MCP allowlist updated successfully' }));
        onSuccess?.();
      } catch (err) {
        console.error('Failed to update MCP allowlist:', err);
        Message.error(t('team.mcp.saveFailed', { defaultValue: 'Failed to update MCP allowlist' }));
      } finally {
        setSaving(false);
      }
    },
    [team.id, selectedIds, t]
  );

  return {
    loading,
    saving,
    servers,
    selectedIds,
    toggleServer,
    handleSave,
  };
}
