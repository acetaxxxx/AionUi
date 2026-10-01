/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Select, Spin } from '@arco-design/web-react';
import { Info, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import AionModal from '@renderer/components/base/AionModal';
import { CollaboratorItem } from './CollaboratorItem';
import type { TeamCollaboratorsModalProps } from './types';
import { useCollaborators } from './useCollaborators';

export const TeamCollaboratorsModal: React.FC<TeamCollaboratorsModalProps> = ({
  visible,
  onClose,
  team,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;

  const {
    isOwner,
    members,
    eligibleAccounts,
    selectedAccountRef,
    setSelectedAccountRef,
    loading,
    adding,
    removingRef,
    handleAddMember,
    handleRemoveMember,
  } = useCollaborators(team, visible);

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={onClose}
      className='team-collaborators-modal'
      style={{
        width: isMobile ? 'calc(100vw - 32px)' : 640,
        maxWidth: isMobile ? 'calc(100vw - 32px)' : 'calc(100vw - 72px)',
      }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      header={{
        title: t('team.collaborators.title', { defaultValue: 'People & Collaborators' }),
        subtitle: t('team.collaborators.subtitle', {
          defaultValue:
            'Manage human collaborators who share this team. AI assistants are managed separately in the team roster.',
        }),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end'>
            <Button onClick={onClose} className='!h-36px min-w-84px !rounded-8px !px-18px !text-13px'>
              {t('common.close', { defaultValue: 'Close' })}
            </Button>
          </div>
        ),
      }}
    >
      <div className='flex flex-col gap-18px p-20px'>
        {/* Owner Add Section */}
        {isOwner ? (
          <div className='flex flex-col gap-8px rounded-8px border border-border-2 bg-fill-1 p-14px'>
            <div className='text-13px font-600 text-t-primary'>
              {t('team.collaborators.addTitle', { defaultValue: 'Add Collaborator' })}
            </div>
            <div className='flex items-center gap-10px'>
              <Select
                placeholder={t('team.collaborators.selectPlaceholder', {
                  defaultValue: 'Select an eligible account...',
                })}
                value={selectedAccountRef}
                onChange={(val) => setSelectedAccountRef(val as string)}
                disabled={adding || loading || eligibleAccounts.length === 0}
                className='flex-1 !h-36px'
                data-testid='team-collaborator-picker'
              >
                {eligibleAccounts.map((acc) => (
                  <Select.Option key={acc.account_ref} value={acc.account_ref}>
                    <div className='flex items-center justify-between'>
                      <span>{acc.display_name}</span>
                      {acc.email && <span className='text-12px text-t-tertiary ms-8px'>{acc.email}</span>}
                    </div>
                  </Select.Option>
                ))}
              </Select>
              <Button
                type='primary'
                onClick={handleAddMember}
                loading={adding}
                disabled={!selectedAccountRef}
                icon={<Plus theme='outline' size='14' fill='currentColor' />}
                className='!h-36px !rounded-8px !px-14px !text-13px shrink-0'
                data-testid='team-collaborator-add-btn'
              >
                {t('team.collaborators.addButton', { defaultValue: 'Add' })}
              </Button>
            </div>
            {eligibleAccounts.length === 0 && !loading && (
              <div className='text-12px text-t-tertiary'>
                {t('team.collaborators.emptyEligible', {
                  defaultValue: 'No eligible accounts available to add.',
                })}
              </div>
            )}
          </div>
        ) : (
          <div className='rounded-8px border border-border-2 bg-fill-1 p-12px text-12px text-t-secondary'>
            {t('team.collaborators.ownerOnlyNotice', {
              defaultValue: 'Only the Team Owner can add or remove collaborators.',
            })}
          </div>
        )}

        {/* Members List Section */}
        <div className='flex flex-col gap-10px'>
          <div className='flex items-center justify-between text-13px font-600 text-t-secondary'>
            <span>
              {t('team.collaborators.membersTitle', {
                count: members.length,
                defaultValue: `Team Members (${members.length})`,
              })}
            </span>
          </div>

          {loading ? (
            <div className='flex h-120px items-center justify-center'>
              <Spin />
            </div>
          ) : members.length === 0 ? (
            <div
              className='flex h-100px items-center justify-center rounded-8px border border-dashed border-border-2 text-13px text-t-tertiary'
            >
              {t('team.collaborators.emptyMembers', { defaultValue: 'No collaborators yet.' })}
            </div>
          ) : (
            <div
              className='flex flex-col gap-8px max-h-240px overflow-y-auto pe-4px'
              data-testid='team-collaborators-list'
            >
              {members.map((member) => (
                <CollaboratorItem
                  key={member.membership_ref}
                  member={member}
                  isOwner={isOwner}
                  isRemoving={removingRef === member.membership_ref}
                  onRemove={handleRemoveMember}
                />
              ))}
            </div>
          )}
        </div>

        {/* Execution & Security Notice */}
        <div className='flex items-start gap-8px rounded-8px bg-fill-2 p-12px text-12px text-t-secondary leading-18px'>
          <Info theme='outline' size='14' className='shrink-0 mt-2px text-t-tertiary' />
          <div>
            <div className='font-600 text-t-primary mb-2px'>
              {t('team.collaborators.executionNotice', { defaultValue: 'Execution & Security Notice' })}
            </div>
            {t('team.collaborators.executionNoticeContent', {
              defaultValue:
                'Collaborators can message the team and trigger agent runs. All runs execute under the Team Owner’s credentials and capabilities with access to the team workspace. Host processes do not provide OS sandbox isolation.',
            })}
          </div>
        </div>
      </div>
    </AionModal>
  );
};

export default TeamCollaboratorsModal;
export * from './types';
export { useCollaborators } from './useCollaborators';
