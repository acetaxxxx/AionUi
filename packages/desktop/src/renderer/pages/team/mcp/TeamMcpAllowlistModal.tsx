/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Checkbox, Spin } from '@arco-design/web-react';
import { Info } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import AionModal from '@renderer/components/base/AionModal';
import type { TeamMcpAllowlistModalProps } from './types';
import { useTeamMcpAllowlist } from './useTeamMcpAllowlist';

export const TeamMcpAllowlistModal: React.FC<TeamMcpAllowlistModalProps> = ({
  visible,
  onClose,
  team,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;

  const { loading, saving, servers, selectedIds, toggleServer, handleSave } = useTeamMcpAllowlist(team, visible);

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={onClose}
      className='team-mcp-allowlist-modal'
      style={{
        width: isMobile ? 'calc(100vw - 32px)' : 600,
        maxWidth: isMobile ? 'calc(100vw - 32px)' : 'calc(100vw - 72px)',
      }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      header={{
        title: t('team.mcp.title', { defaultValue: 'Team MCP Servers' }),
        subtitle: t('team.mcp.subtitle', {
          defaultValue: 'Configure which MCP servers can be used by team members.',
        }),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-10px'>
            <Button
              onClick={onClose}
              disabled={saving}
              className='!h-36px min-w-84px !rounded-8px !px-18px !text-13px'
              data-testid='team-mcp-cancel-button'
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type='primary'
              onClick={() => handleSave(onClose)}
              loading={saving}
              disabled={loading}
              className='!h-36px min-w-84px !rounded-8px !px-18px !text-13px'
              data-testid='team-mcp-save-button'
            >
              {t('team.mcp.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        ),
      }}
    >
      <div className='flex flex-col gap-16px p-20px' data-testid='team-mcp-allowlist-modal'>
        {/* Security & Access Disclosure */}
        <div
          className='flex items-start gap-10px rounded-8px border border-border-2 bg-fill-2 p-12px text-12px text-t-secondary leading-18px'
          data-testid='team-mcp-disclosure'
        >
          <Info theme='outline' size='16' className='shrink-0 mt-2px text-t-tertiary' />
          <div>
            <div className='font-600 text-t-primary mb-2px'>
              {t('team.mcp.disclosureTitle', { defaultValue: 'MCP Security & Access' })}
            </div>
            <div>
              {t('team.mcp.disclosure', {
                defaultValue:
                  'Selected MCP servers execute using Team Owner credentials and can be invoked by Team members. Unselected personal MCP servers remain unavailable. No collaborator credentials are used.',
              })}
            </div>
          </div>
        </div>

        {/* Server List */}
        {loading ? (
          <div className='flex h-160px items-center justify-center'>
            <Spin />
          </div>
        ) : servers.length === 0 ? (
          <div
            className='flex h-120px items-center justify-center rounded-8px border border-dashed border-border-2 text-13px text-t-tertiary p-16px text-center'
            data-testid='team-mcp-empty-state'
          >
            {t('team.mcp.emptyServers', {
              defaultValue: 'No personal MCP servers configured yet. Add MCP servers in Settings first.',
            })}
          </div>
        ) : (
          <div className='flex flex-col gap-8px max-h-320px overflow-y-auto pe-4px'>
            {servers.map((server) => {
              const isChecked = selectedIds.includes(server.id);
              return (
                <div
                  key={server.id}
                  data-testid={`team-mcp-item-${server.id}`}
                  onClick={() => toggleServer(server.id)}
                  className='flex items-center justify-between p-12px rounded-8px border border-border-2 bg-fill-1 hover:bg-fill-2 cursor-pointer transition-colors'
                >
                  <div className='flex flex-col gap-2px min-w-0 pe-12px'>
                    <span className='text-13px font-500 text-t-primary truncate'>{server.name}</span>
                    {server.description && (
                      <span className='text-12px text-t-tertiary truncate'>{server.description}</span>
                    )}
                  </div>
                  <Checkbox
                    checked={isChecked}
                    onChange={() => toggleServer(server.id)}
                    data-testid={`team-mcp-checkbox-${server.id}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AionModal>
  );
};

export default TeamMcpAllowlistModal;
