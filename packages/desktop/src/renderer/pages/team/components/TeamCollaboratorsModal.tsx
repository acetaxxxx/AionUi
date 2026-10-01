/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Modal, Select, Spin, Tag } from '@arco-design/web-react';
import { Info, Peoples, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { EligibleCollaborator, TeamMember, TTeam } from '@/common/types/team/teamTypes';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import AionModal from '@renderer/components/base/AionModal';

type Props = {
  visible: boolean;
  onClose: () => void;
  team: TTeam;
};

const TeamCollaboratorsModal: React.FC<Props> = ({ visible, onClose, team }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;

  const isOwner = team.current_member_role === 'owner' || team.user_id === user?.id;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [eligibleAccounts, setEligibleAccounts] = useState<EligibleCollaborator[]>([]);
  const [selectedAccountRef, setSelectedAccountRef] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingRef, setRemovingRef] = useState<string | null>(null);

  const fetchMembersAndEligible = useCallback(async () => {
    if (!team.id) return;
    setLoading(true);
    try {
      const memberListPromise = ipcBridge.team.listMembers.invoke({ team_id: team.id });
      const eligiblePromise = isOwner
        ? ipcBridge.team.listEligibleCollaborators.invoke()
        : Promise.resolve([] as EligibleCollaborator[]);

      const [memberList, eligibleList] = await Promise.all([memberListPromise, eligiblePromise]);

      if (Array.isArray(memberList)) {
        setMembers(memberList);
      }
      if (Array.isArray(eligibleList)) {
        setEligibleAccounts(eligibleList);
      }
    } catch (err) {
      console.error('Failed to load team collaborators:', err);
      Message.error(t('team.collaborators.loadError', { defaultValue: 'Failed to load collaborators' }));
    } finally {
      setLoading(false);
    }
  }, [team.id, isOwner, t]);

  useEffect(() => {
    if (visible) {
      void fetchMembersAndEligible();
      setSelectedAccountRef(undefined);
    }
  }, [visible, fetchMembersAndEligible]);

  const handleAddMember = async () => {
    if (!selectedAccountRef) return;
    setAdding(true);
    try {
      const added = await ipcBridge.team.addMember.invoke({
        team_id: team.id,
        account_ref: selectedAccountRef,
      });

      const result = added as unknown as { __bridgeError?: boolean; message?: string };
      if (result?.__bridgeError) {
        Message.error(result.message ?? t('team.collaborators.addError', { defaultValue: 'Failed to add collaborator' }));
        return;
      }

      Message.success(t('team.collaborators.addSuccess', { defaultValue: 'Collaborator added successfully' }));
      setSelectedAccountRef(undefined);
      // Immediately reflect added member in local state
      setMembers((prev) => {
        if (prev.some((m) => m.membership_ref === added.membership_ref)) return prev;
        return [...prev, added];
      });
      // Remove from eligible list
      setEligibleAccounts((prev) => prev.filter((acc) => acc.account_ref !== selectedAccountRef));
    } catch (err) {
      console.error('Failed to add collaborator:', err);
      Message.error(t('team.collaborators.addError', { defaultValue: 'Failed to add collaborator' }));
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = (member: TeamMember) => {
    if (member.role === 'owner') return;

    Modal.confirm({
      title: t('team.collaborators.removeConfirmTitle', { defaultValue: 'Remove Collaborator' }),
      content: t('team.collaborators.removeConfirmContent', {
        name: member.display_name,
        defaultValue: `Are you sure you want to remove ${member.display_name} from this team? They will immediately lose access to team conversations and workspace.`,
      }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setRemovingRef(member.membership_ref);
        try {
          await ipcBridge.team.removeMember.invoke({
            team_id: team.id,
            membership_ref: member.membership_ref,
          });
          Message.success(
            t('team.collaborators.removeSuccess', { defaultValue: 'Collaborator removed successfully' })
          );
          setMembers((prev) => prev.filter((m) => m.membership_ref !== member.membership_ref));
          if (isOwner) {
            void ipcBridge.team.listEligibleCollaborators.invoke().then((list) => {
              if (Array.isArray(list)) setEligibleAccounts(list);
            });
          }
        } catch (err) {
          console.error('Failed to remove collaborator:', err);
          Message.error(t('team.collaborators.removeError', { defaultValue: 'Failed to remove collaborator' }));
        } finally {
          setRemovingRef(null);
        }
      },
    });
  };

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
            <div className='flex h-100px items-center justify-center rounded-8px border border-dashed border-border-2 text-13px text-t-tertiary'>
              {t('team.collaborators.emptyMembers', { defaultValue: 'No collaborators yet.' })}
            </div>
          ) : (
            <div
              className='flex flex-col gap-8px max-h-240px overflow-y-auto pe-4px'
              data-testid='team-collaborators-list'
            >
              {members.map((member) => {
                const isMemberOwner = member.role === 'owner';
                const canRemove = isOwner && !isMemberOwner;
                return (
                  <div
                    key={member.membership_ref}
                    className='flex items-center justify-between rounded-8px border border-border-2 bg-bg-2 px-14px py-10px'
                    data-testid={`team-collaborator-item-${member.membership_ref}`}
                  >
                    <div className='flex items-center gap-10px min-w-0'>
                      <div className='flex size-32px items-center justify-center rounded-full bg-fill-3 text-t-secondary shrink-0'>
                        <Peoples theme='outline' size='16' fill='currentColor' />
                      </div>
                      <div className='flex flex-col min-w-0'>
                        <div className='flex items-center gap-8px'>
                          <span className='text-13px font-500 text-t-primary truncate'>
                            {member.display_name}
                          </span>
                          <Tag
                            color={isMemberOwner ? 'arcoblue' : 'green'}
                            size='small'
                            className='!text-11px'
                            data-testid={`team-collaborator-role-${member.membership_ref}`}
                          >
                            {isMemberOwner
                              ? t('team.collaborators.roleOwner', { defaultValue: 'Owner' })
                              : t('team.collaborators.roleCollaborator', { defaultValue: 'Collaborator' })}
                          </Tag>
                        </div>
                        {member.email && (
                          <span className='text-12px text-t-tertiary truncate'>{member.email}</span>
                        )}
                      </div>
                    </div>

                    {canRemove && (
                      <Button
                        type='text'
                        status='danger'
                        size='small'
                        loading={removingRef === member.membership_ref}
                        onClick={() => handleRemoveMember(member)}
                        className='!text-12px !px-8px shrink-0'
                        data-testid={`team-collaborator-remove-${member.membership_ref}`}
                      >
                        {t('team.collaborators.remove', { defaultValue: 'Remove' })}
                      </Button>
                    )}
                  </div>
                );
              })}
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
