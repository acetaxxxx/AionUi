/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Attention, CheckSmall, Copy, LoadingTwo, ShareTwo } from '@icon-park/react';
import { Button, Input, Modal, Message } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PublishShareResult, publishMarkdownShare } from './markdownSharePublish';

export type MarkdownShareButtonProps = {
  content: string;
  title?: string;
  filePath?: string;
  workspace?: string;
  className?: string;
};

const OpenExternalIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
    <polyline points='15 3 21 3 21 9' />
    <line x1='10' y1='14' x2='21' y2='3' />
  </svg>
);

export const MarkdownShareButton: React.FC<MarkdownShareButtonProps> = ({
  content,
  title,
  filePath,
  workspace,
  className = '',
}) => {
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shareResult, setShareResult] = useState<PublishShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleShareClick = useCallback(async () => {
    setModalVisible(true);
    setPublishing(true);
    setError(null);
    setShareResult(null);

    try {
      const result = await publishMarkdownShare(content, title, { filePath, workspace });
      setShareResult(result);
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to publish share snapshot';
      setError(msg);
      Message.error(msg);
    } finally {
      setPublishing(false);
    }
  }, [content, title, filePath, workspace]);

  const handleCopyLink = useCallback(() => {
    if (!shareResult?.shareUrl) return;
    navigator.clipboard
      .writeText(shareResult.shareUrl)
      .then(() => {
        setCopied(true);
        Message.success(t('common.copySuccess', { defaultValue: 'Link copied to clipboard' }));
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed', { defaultValue: 'Failed to copy link' }));
      });
  }, [shareResult?.shareUrl, t]);

  const handleOpenLink = useCallback(() => {
    if (!shareResult?.shareUrl) return;
    window.open(shareResult.shareUrl, '_blank', 'noopener,noreferrer');
  }, [shareResult?.shareUrl]);

  return (
    <>
      <div
        className={`flex items-center gap-2px px-8px py-3px rd-4px cursor-pointer transition-colors duration-150 text-12px font-medium text-t-secondary hover:text-t-primary hover:bg-bg-3 ${className}`}
        onClick={handleShareClick}
        title={t('preview.shareMarkdown', { defaultValue: 'Share Markdown Snapshot' })}
      >
        <ShareTwo size='12' className='text-t-secondary' />
        <span>{t('common.share', { defaultValue: 'Share' })}</span>
      </div>

      <Modal
        visible={modalVisible}
        title={t('preview.shareModalTitle', { defaultValue: 'Share Markdown Snapshot' })}
        onCancel={() => setModalVisible(false)}
        footer={null}
        unmountOnExit
      >
        <div className='flex flex-col gap-4 py-2'>
          {publishing && (
            <div className='flex flex-col items-center justify-center py-6 text-center gap-2'>
              <LoadingTwo className='animate-spin text-blue-500' size='28' />
              <p className='text-xs text-gray-500 font-medium'>
                {t('preview.publishingShare', { defaultValue: 'Creating public share link...' })}
              </p>
            </div>
          )}

          {error && !publishing && (
            <div className='flex flex-col items-center justify-center py-4 text-center gap-2 border border-red-200 rounded p-4 bg-red-50/40 dark:bg-red-950/20'>
              <Attention className='text-red-500' size='32' />
              <p className='text-xs text-red-600 dark:text-red-400 font-medium'>{error}</p>
              <Button type='primary' size='small' status='danger' onClick={handleShareClick} className='mt-2'>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          )}

          {shareResult && !publishing && (
            <div className='flex flex-col gap-3'>
              <p className='text-xs text-gray-600 dark:text-gray-300'>
                {t('preview.shareCreatedDesc', {
                  defaultValue: 'Anyone with this public link can view a read-only snapshot of this document:',
                })}
              </p>

              <div className='flex items-center gap-2'>
                <Input value={shareResult.shareUrl} readOnly className='font-mono text-xs' />
                <Button type='primary' onClick={handleCopyLink} icon={copied ? <CheckSmall /> : <Copy />}>
                  {copied ? t('common.copied', { defaultValue: 'Copied' }) : t('common.copy', { defaultValue: 'Copy' })}
                </Button>
              </div>

              <div className='flex items-center justify-between mt-2 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500'>
                <span>
                  {t('preview.shareExpiresNotice', {
                    defaultValue: 'Public share links are read-only and unauthenticated.',
                  })}
                </span>
                <Button type='text' size='small' onClick={handleOpenLink} icon={<OpenExternalIcon />}>
                  {t('common.openInBrowser', { defaultValue: 'Open' })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default MarkdownShareButton;
