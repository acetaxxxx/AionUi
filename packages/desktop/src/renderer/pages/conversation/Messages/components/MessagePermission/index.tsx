/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMessagePermission } from '@/common/chat/chatLib';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import { PermissionRequestPanel } from './PermissionRequestPanel';
import {
  classifyLegacyPermission,
  normalizePermissionOperationKind,
  type PermissionPanelOption,
} from './permissionOptions';

type MessagePermissionProps = {
  message: IMessagePermission;
};

const MessagePermission: React.FC<MessagePermissionProps> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();
  const conversationContext = useConversationContextSafe();
  const isTeam = Boolean(teamPermission || conversationContext?.team_id);
  const isOwner = teamPermission ? teamPermission.isOwner : true;
  const isCollaborator = isTeam && !isOwner;

  const content = message.content || ({} as IMessagePermission['content']);
  const { description, title, action, call_id, command_type } = content;
  const options = Array.isArray(content.options) ? content.options : [];
  const displayTitle = title || description || t('messages.permissionRequest');

  const panelOptions = useMemo<PermissionPanelOption[]>(
    () =>
      options.map((option, index) => {
        const value = option ? String(option.value) : '';
        const fallbackId = `option_${index}`;
        const label = option?.label || `${t('messages.option')} ${index + 1}`;
        return {
          id: `${value || fallbackId}:${index}`,
          value,
          label: t(label, { ...option?.params, defaultValue: label }),
          intent: classifyLegacyPermission(value),
          testId: `message-permission-option-${value || fallbackId}`,
        };
      }),
    [options, t]
  );

  const handleConfirm = useCallback(
    async (selectedValue: string) => {
      if (isCollaborator) {
        return;
      }
      await ipcBridge.conversation.confirmation.confirm.invoke({
        conversation_id: message.conversation_id,
        call_id,
        msg_id: message.msg_id || '',
        data: { value: selectedValue },
        always_allow: selectedValue === 'proceed_always',
      });
    },
    [call_id, isCollaborator, message.conversation_id, message.msg_id]
  );

  return (
    <PermissionRequestPanel
      requestKey={`${message.id}:${call_id}`}
      testIdPrefix='message-permission'
      title={displayTitle}
      description={description && description !== displayTitle ? description : undefined}
      operationKind={normalizePermissionOperationKind(action)}
      detail={command_type}
      options={panelOptions}
      onConfirm={handleConfirm}
      ownerApprovalRequired={isCollaborator}
    />
  );
});

export { PermissionRequestPanel } from './PermissionRequestPanel';
export {
  classifyAcpPermission,
  classifyLegacyPermission,
  getPermissionOptionsIdentity,
  getSafePermissionOptionId,
  normalizePermissionOperationKind,
} from './permissionOptions';
export type { PermissionIntent, PermissionOperationKind, PermissionPanelOption } from './permissionOptions';
export default MessagePermission;
