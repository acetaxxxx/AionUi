/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DragEndEvent } from '@dnd-kit/core';
import type { AssistantListItem } from '../types';
import { type AssistantEnabledFilter, filterByEnabled, groupMyAssistants } from '../assistantUtils';
import MyAssistantRow from './MyAssistantRow';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Dropdown, Menu, Button } from '@arco-design/web-react';
import { Down, SortTwo } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type MyAssistantsListProps = {
  assistants: AssistantListItem[];
  localeKey: string;
  onOpenDetail: (assistant: AssistantListItem) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  onReorder: (activeId: string, overId: string) => void | Promise<void>;
  onStartChat: (assistant: AssistantListItem) => void;
};

const FILTER_OPTIONS: AssistantEnabledFilter[] = ['all', 'enabled', 'disabled'];

const MyAssistantsList: React.FC<MyAssistantsListProps> = ({
  assistants,
  localeKey,
  onOpenDetail,
  onDelete,
  onToggleEnabled,
  onReorder,
  onStartChat,
}) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AssistantEnabledFilter>('all');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Drag reorder is only meaningful in the unfiltered "all" view; a filtered
  // view hides rows, so dragging would produce an ambiguous global order.
  const draggable = filter === 'all';

  const { cliAssistants, createdAssistants } = useMemo(() => {
    const filtered = filterByEnabled(assistants, filter);
    return groupMyAssistants(filtered);
  }, [assistants, filter]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!draggable || !over || active.id === over.id) return;
      void onReorder(String(active.id), String(over.id));
    },
    [draggable, onReorder]
  );

  const filterMenu = (
    <Menu onClickMenuItem={(key) => setFilter(key as AssistantEnabledFilter)}>
      {FILTER_OPTIONS.map((option) => (
        <Menu.Item key={option} data-testid={`filter-option-${option}`}>
          {t(`settings.assistantFilter.${option}`, {
            defaultValue: option === 'all' ? 'All' : option === 'enabled' ? 'Enabled' : 'Disabled',
          })}
        </Menu.Item>
      ))}
    </Menu>
  );

  const renderGroup = (title: string, list: AssistantListItem[], testId: string, barClass: string) => {
    if (list.length === 0) return null;
    return (
      <div className='mt-20px first:mt-0' data-testid={testId}>
        <div className='mb-10px flex items-center gap-8px px-2px'>
          <span className={`h-13px w-3px rounded-2px ${barClass}`} />
          <span className='text-12px font-600 text-t-secondary'>{title}</span>
          <span className='rounded-999px bg-fill-2 px-6px py-1px text-10px font-500 text-t-quaternary'>{list.length}</span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={list.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className='space-y-8px'>
              {list.map((assistant) => (
                <MyAssistantRow
                  key={assistant.id}
                  assistant={assistant}
                  localeKey={localeKey}
                  draggable={draggable}
                  onOpenDetail={onOpenDetail}
                  onDelete={onDelete}
                  onToggleEnabled={onToggleEnabled}
                  onStartChat={onStartChat}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  };

  const isEmpty = cliAssistants.length === 0 && createdAssistants.length === 0;

  return (
    <div data-testid='my-assistants-pane'>
      {/* Compact toolbar: a quiet reorder hint (icon + tooltip) on the left, the
          enabled filter on the right — no full-width banner hogging a row. */}
      <div className='mb-4px flex items-center justify-between'>
        <span className='inline-flex min-w-0 items-center gap-6px text-12px text-t-tertiary'>
          <SortTwo theme='outline' size={14} fill='currentColor' className='block shrink-0 leading-none text-t-quaternary' style={{ lineHeight: 0 }} />
          <span className='truncate'>
            {t('settings.myAssistantsHintShort', {
              defaultValue: 'Your own assistants — used wherever you pick one. Drag to reorder.',
            })}
          </span>
        </span>
        <Dropdown droplist={filterMenu} trigger='click' position='br'>
          <Button size='mini' data-testid='assistant-enabled-filter' className='!flex !items-center !gap-4px !rounded-8px'>
            <span>
              {t(`settings.assistantFilter.${filter}`, {
                defaultValue: filter === 'all' ? 'All' : filter === 'enabled' ? 'Enabled' : 'Disabled',
              })}
            </span>
            <Down theme='outline' size={12} fill='currentColor' />
          </Button>
        </Dropdown>
      </div>

      {isEmpty ? (
        <div className='py-40px text-center text-13px text-t-secondary' data-testid='my-assistants-empty'>
          {t('settings.myAssistantsEmpty', {
            defaultValue: 'No assistants here yet. Enable an official assistant, or connect a local CLI tool.',
          })}
        </div>
      ) : (
        <>
          {renderGroup(t('settings.assistantGroupCli', { defaultValue: 'Your CLI' }), cliAssistants, 'group-cli', 'bg-warning-5')}
          {renderGroup(
            t('settings.assistantGroupCreated', { defaultValue: 'Created by you' }),
            createdAssistants,
            'group-created',
            'bg-primary-5'
          )}
        </>
      )}
    </div>
  );
};

export default MyAssistantsList;
