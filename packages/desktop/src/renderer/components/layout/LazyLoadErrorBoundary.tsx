/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

type LazyLoadErrorBoundaryProps = {
  children: React.ReactNode;
  /** Allows tests and embedded surfaces to provide their own reload action. */
  onReload?: () => void;
  compact?: boolean;
};

type LazyLoadErrorBoundaryState = {
  hasError: boolean;
};

const reloadPage = (): void => {
  window.location.reload();
};

export const LazyLoadErrorFallback: React.FC<Pick<LazyLoadErrorBoundaryProps, 'onReload' | 'compact'>> = ({
  onReload = reloadPage,
  compact = false,
}) => {
  const { t } = useTranslation();

  return (
    <div
      role='alert'
      data-testid='lazy-load-error'
      className={
        compact
          ? 'size-full flex items-center justify-center p-8px'
          : 'size-full min-h-240px flex items-center justify-center bg-1 p-24px'
      }
    >
      <div className='max-w-360px text-center'>
        <Typography.Title heading={5} className='mb-8px text-t-primary'>
          {t('common.error')}
        </Typography.Title>
        {!compact && (
          <Typography.Paragraph className='mb-16px text-t-secondary'>{t('common.unknownError')}</Typography.Paragraph>
        )}
        <Button type='primary' onClick={onReload}>
          {t('common.reload')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Catches rejected React.lazy imports (for example a PWA chunk that was evicted
 * during a service-worker update) so the renderer can offer recovery instead of
 * unmounting the entire React tree and leaving a blank screen.
 */
class LazyLoadErrorBoundary extends React.Component<LazyLoadErrorBoundaryProps, LazyLoadErrorBoundaryState> {
  state: LazyLoadErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyLoadErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    console.error('[LazyLoadErrorBoundary] Failed to load renderer content:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <LazyLoadErrorFallback onReload={this.props.onReload} compact={this.props.compact} />;
    }

    return this.props.children;
  }
}

export default LazyLoadErrorBoundary;
