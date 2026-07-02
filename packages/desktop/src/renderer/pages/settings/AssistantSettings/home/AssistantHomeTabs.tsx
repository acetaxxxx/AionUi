/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AssistantListItem } from '../types';
import MyAssistantsList from './MyAssistantsList';
import OfficialAssistantsGrid from './OfficialAssistantsGrid';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import { Button } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AssistantHomeTabsProps = {
  assistants: AssistantListItem[];
  localeKey: string;
  onOpenDetail: (assistant: AssistantListItem) => void;
  onOpenSettings: (assistant: AssistantListItem) => void;
  onDuplicate: (assistant: AssistantListItem) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onCreate: () => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  onReorder: (activeId: string, overId: string) => void | Promise<void>;
  onStartChat: (assistant: AssistantListItem) => void;
};

type HomeTab = 'mine' | 'official';

const COACH_STORAGE_KEY = 'assistantHome.reorderCoachSeen';

const AssistantHomeTabs: React.FC<AssistantHomeTabsProps> = ({
  assistants,
  localeKey,
  onOpenDetail,
  onOpenSettings,
  onDuplicate,
  onDelete,
  onCreate,
  onToggleEnabled,
  onReorder,
  onStartChat,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [tab, setTab] = useState<HomeTab>('mine');
  const [showCoach, setShowCoach] = useState(false);

  const counts = useMemo(() => {
    let mine = 0;
    let official = 0;
    for (const assistant of assistants) {
      if (assistant.source === 'builtin') official += 1;
      else mine += 1;
    }
    return { mine, official };
  }, [assistants]);

  // First-visit coach mark for the reorder gesture (shown once).
  useEffect(() => {
    if (tab !== 'mine') return;
    let seen = false;
    try {
      seen = localStorage.getItem(COACH_STORAGE_KEY) === '1';
    } catch {
      seen = false;
    }
    if (!seen) setShowCoach(true);
  }, [tab]);

  const dismissCoach = () => {
    setShowCoach(false);
    try {
      localStorage.setItem(COACH_STORAGE_KEY, '1');
    } catch {
      // ignore storage failures — coach simply reappears next time
    }
  };

  const tabButton = (key: HomeTab, label: string, count: number) => (
    <button
      type='button'
      data-testid={`assistant-tab-${key}`}
      onClick={() => setTab(key)}
      className={`relative inline-flex cursor-pointer items-center border-none bg-transparent px-2px pb-12px text-14px leading-none transition-colors ${
        tab === key ? 'font-600 text-t-primary' : 'font-500 text-t-tertiary hover:text-t-secondary'
      }`}
    >
      <span>{label}</span>
      <span
        className={`ml-6px inline-flex h-16px min-w-16px items-center justify-center rounded-999px px-5px text-10px font-500 leading-none ${
          tab === key ? 'bg-primary-1 text-primary-6' : 'bg-fill-2 text-t-quaternary'
        }`}
      >
        {count}
      </span>
      {tab === key ? <span className='absolute inset-x-0 -bottom-1px h-2px rounded-2px bg-primary-6' /> : null}
    </button>
  );

  return (
    <div data-testid='assistant-home-shell' className='flex h-full min-h-0 flex-col overflow-hidden bg-transparent'>
      <div className={`border-b border-border-2 bg-bg-0 ${isMobile ? 'px-16px pt-14px' : 'px-12px pt-24px md:px-40px md:pt-32px'}`}>
        <div className='mx-auto w-full max-w-800px'>
          <div className='flex w-full items-center justify-between gap-12px sm:gap-16px'>
            <h1
              className={classNames(
                'm-0 min-w-0 flex-1 font-bold text-t-primary',
                isMobile ? 'text-22px leading-[1.2]' : 'text-28px leading-[1.15]'
              )}
            >
              {t('settings.assistants', { defaultValue: 'Assistants' })}
            </h1>
            <TalkToButlerButton
              className='shrink-0'
              label={t('settings.createAssistant', { defaultValue: 'Create Assistant' })}
              chatLabel={t('settings.talkToButler.createViaChat', { defaultValue: 'Create via chat' })}
              onManual={onCreate}
              manualLabel={t('settings.talkToButler.createManually', { defaultValue: 'Create manually' })}
              prompt={t('settings.talkToButler.prompt.createAssistant', {
                defaultValue: 'Help me create a new assistant and walk me through setting it up.',
              })}
              data-testid='btn-create-assistant'
            />
          </div>
          <p
            className={classNames(
              'm-0 mt-8px w-full text-t-secondary',
              isMobile ? 'text-13px leading-20px' : 'text-14px leading-22px'
            )}
          >
            {t('settings.assistantHomeLeadShort', {
              defaultValue: 'Ready-to-work AI experts, preloaded with skills. Enable one and it shows up wherever you pick an assistant.',
            })}
          </p>
          <div className='mt-18px flex gap-26px'>
            {tabButton('mine', t('settings.assistantTabMine', { defaultValue: 'My Assistants' }), counts.mine)}
            {tabButton('official', t('settings.assistantTabOfficial', { defaultValue: 'Official' }), counts.official)}
          </div>
        </div>
      </div>

      <div
        data-testid='assistant-home-body'
        className={`relative min-h-0 flex-1 overflow-auto ${isMobile ? 'px-16px pb-14px pt-14px' : 'px-12px pb-24px pt-18px md:px-40px'}`}
      >
        <div className='mx-auto w-full max-w-800px'>
          {tab === 'mine' ? (
            <MyAssistantsList
              assistants={assistants}
              localeKey={localeKey}
              onOpenDetail={onOpenDetail}
              onDelete={onDelete}
              onToggleEnabled={onToggleEnabled}
              onReorder={onReorder}
              onStartChat={onStartChat}
            />
          ) : (
            <OfficialAssistantsGrid
              assistants={assistants}
              localeKey={localeKey}
              onOpenSettings={onOpenSettings}
              onDuplicate={onDuplicate}
              onToggleEnabled={onToggleEnabled}
              onStartChat={onStartChat}
            />
          )}
        </div>

        {showCoach ? (
          <div className='absolute inset-0 z-50 bg-[rgba(20,23,40,0.28)]' onClick={dismissCoach} data-testid='reorder-coach-mask'>
            <div
              className='absolute left-24px top-96px w-320px rounded-14px bg-bg-0 p-18px shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='mb-8px text-14px font-700 text-t-primary'>
                {t('settings.reorderCoachTitle', { defaultValue: 'Drag to reorder' })}
              </div>
              <p className='mb-14px text-12px leading-[1.65] text-t-secondary'>
                {t('settings.reorderCoachBody', {
                  defaultValue:
                    'Drag your favorite assistants to the top — this order decides how they appear wherever you pick an assistant (home, teams, scheduled tasks).',
                })}
              </p>
              <div className='flex justify-end'>
                <Button type='primary' size='small' onClick={dismissCoach} data-testid='reorder-coach-dismiss'>
                  {t('common.confirm', { defaultValue: 'Got it' })}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AssistantHomeTabs;
