/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Attention, CheckSmall, Copy, FileFailed, LoadingTwo, Time } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { iconColors } from '@/renderer/styles/colors';
import MarkdownView from '@renderer/components/Markdown';
import {
  PublicShare,
  PublicShareError,
  fetchPublicShare,
  formatAssetSize,
  formatShareDate,
  isShareExpired,
  rewritePublicShareMarkdown,
} from './publicShareUtils';

export type PublicShareViewerProps = {
  token: string;
  baseUrl?: string;
  className?: string;
  onLoad?: (share: PublicShare) => void;
  onError?: (error: PublicShareError) => void;
  fetchFn?: typeof fetch;
};

export type PublicShareViewerState = 'loading' | 'success' | 'not_found' | 'expired' | 'error';

export const PublicShareViewer: React.FC<PublicShareViewerProps> = ({
  token,
  baseUrl = '',
  className = '',
  onLoad,
  onError,
  fetchFn,
}) => {
  const [status, setStatus] = useState<PublicShareViewerState>('loading');
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState<PublicShareError | null>(null);
  const [copied, setCopied] = useState(false);

  const loadShare = useCallback(async () => {
    if (!token) {
      setStatus('not_found');
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      const data = await fetchPublicShare(token, { baseUrl, fetchFn });
      if (isShareExpired(data.expiresAt)) {
        setStatus('expired');
        const expErr = new PublicShareError('EXPIRED', 410, 'Share has expired');
        setError(expErr);
        onError?.(expErr);
        return;
      }

      setShare(data);
      setStatus('success');
      onLoad?.(data);
    } catch (err) {
      const shareErr =
        err instanceof PublicShareError
          ? err
          : new PublicShareError('FETCH_FAILED', 0, (err as Error)?.message || 'Failed to load share');

      setError(shareErr);
      if (shareErr.code === 'NOT_FOUND') {
        setStatus('not_found');
      } else if (shareErr.code === 'EXPIRED') {
        setStatus('expired');
      } else {
        setStatus('error');
      }
      onError?.(shareErr);
    }
  }, [token, baseUrl, fetchFn, onLoad, onError]);

  useEffect(() => {
    loadShare();
  }, [loadShare]);

  const processedMarkdown = useMemo(() => {
    if (!share) return '';
    return rewritePublicShareMarkdown(share.markdown, token, share.assets, baseUrl);
  }, [share, token, baseUrl]);

  const handleCopyLink = useCallback(() => {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    if (currentUrl && navigator.clipboard) {
      navigator.clipboard
        .writeText(currentUrl)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  }, []);

  if (status === 'loading') {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[300px] p-8 text-center ${className}`}>
        <LoadingTwo className='animate-spin mb-3' size='28' fill={iconColors.primary} strokeWidth={2} />
        <p className='text-sm text-gray-500 font-medium'>Loading shared document...</p>
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[320px] p-8 text-center border border-dashed rounded-lg bg-gray-50/50 dark:bg-gray-800/20 ${className}`}>
        <FileFailed className='mb-3 text-gray-400' size='40' theme='outline' />
        <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200 mb-1'>Share Not Found</h3>
        <p className='text-xs text-gray-500 max-w-sm mb-4'>
          This shared document link does not exist, or has been revoked by its owner.
        </p>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[320px] p-8 text-center border border-dashed rounded-lg bg-amber-50/40 dark:bg-amber-900/10 ${className}`}>
        <Time className='mb-3 text-amber-500' size='40' theme='outline' />
        <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200 mb-1'>Share Expired</h3>
        <p className='text-xs text-gray-500 max-w-sm mb-4'>
          This shared document has expired and is no longer available for viewing.
          {share?.expiresAt ? ` Expired on ${formatShareDate(share.expiresAt)}.` : ''}
        </p>
      </div>
    );
  }

  if (status === 'error' || !share) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[320px] p-8 text-center border border-red-200 rounded-lg bg-red-50/30 dark:bg-red-900/10 ${className}`}>
        <Attention className='mb-3 text-red-500' size='40' theme='outline' />
        <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200 mb-1'>Unable to Load Share</h3>
        <p className='text-xs text-gray-500 max-w-sm mb-4'>
          {error?.message || 'An error occurred while connecting to the share server.'}
        </p>
        <button
          onClick={loadShare}
          className='px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors'
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-4xl mx-auto flex flex-col gap-4 ${className}`}>
      {/* Header bar */}
      <header className='flex flex-wrap items-center justify-between gap-3 p-4 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900 shadow-sm'>
        <div className='flex flex-col gap-1 min-w-0'>
          <h1 className='text-lg font-bold text-gray-900 dark:text-gray-100 truncate'>
            {share.title || 'Shared Document'}
          </h1>
          <div className='flex flex-wrap items-center gap-3 text-xs text-gray-500'>
            {share.createdAt && <span>Created {formatShareDate(share.createdAt)}</span>}
            {share.expiresAt && <span className='text-amber-600 dark:text-amber-400'>Expires {formatShareDate(share.expiresAt)}</span>}
            {share.assets.length > 0 && (
              <span className='px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-[11px]'>
                {share.assets.length} {share.assets.length === 1 ? 'asset' : 'assets'} (
                {formatAssetSize(share.assets.reduce((sum, a) => sum + a.size, 0))})
              </span>
            )}
          </div>
        </div>

        <button
          onClick={handleCopyLink}
          className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
        >
          {copied ? <CheckSmall size='16' fill='#10b981' /> : <Copy size='14' />}
          <span>{copied ? 'Copied Link' : 'Copy Link'}</span>
        </button>
      </header>

      {/* Main Markdown document container */}
      <main className='w-full p-6 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900 shadow-sm overflow-hidden'>
        <MarkdownView allowHtml={false}>{processedMarkdown}</MarkdownView>
      </main>
    </div>
  );
};

export default PublicShareViewer;
