/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.error': 'Error',
        'common.unknownError': 'The page could not be loaded.',
        'common.reload': 'Reload',
      })[key] ?? key,
  }),
}));

import LazyLoadErrorBoundary from '@/renderer/components/layout/LazyLoadErrorBoundary';

const BrokenPage = () => {
  throw new Error('Failed to fetch dynamically imported module');
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LazyLoadErrorBoundary', () => {
  it('keeps a failed lazy route actionable instead of rendering a blank root', () => {
    const onReload = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <LazyLoadErrorBoundary onReload={onReload}>
        <BrokenPage />
      </LazyLoadErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The page could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
