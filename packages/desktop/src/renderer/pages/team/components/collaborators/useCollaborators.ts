/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { Message, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { EligibleCollaborator, TeamMember, TTeam } from '@/common/types/team/teamTypes';
import { useAuth } from '@renderer/hooks/context/AuthContext';

export function useCollaborators(team: TTeam, visible: boolean) {
  const { t } = useTranslation();
  const { user } = useAuth();

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
      setMembers((prev) => {
        if (prev.some((m) => m.membership_ref === added.membership_ref)) return prev;
        return [...prev, added];
      });
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

  return {
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
  };
}
