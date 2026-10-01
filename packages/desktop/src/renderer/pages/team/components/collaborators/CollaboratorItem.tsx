/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tag } from '@arco-design/web-react';
import { Peoples } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { CollaboratorItemProps } from './types';

export const CollaboratorItem: React.FC<CollaboratorItemProps> = ({
  member,
  isOwner,
  isRemoving,
  onRemove,
}) => {
  const { t } = useTranslation();
  const isMemberOwner = member.role === 'owner';
  const canRemove = isOwner && !isMemberOwner;

  return (
    <div
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
          loading={isRemoving}
          onClick={() => onRemove(member)}
          className='!text-12px !px-8px shrink-0'
          data-testid={`team-collaborator-remove-${member.membership_ref}`}
        >
          {t('team.collaborators.remove', { defaultValue: 'Remove' })}
        </Button>
      )}
    </div>
  );
};

export default CollaboratorItem;
