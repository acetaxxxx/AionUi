/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { systemInfo: { invoke: vi.fn().mockResolvedValue({ workDir: '/' }) } },
    fs: { getFilesByDir: { invoke: vi.fn().mockResolvedValue([]) } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import { WebFsPicker } from '@/renderer/components/workspace/webFsPicker';

afterEach(() => cleanup());

describe('WebFsPicker responsive dialog', () => {
  it('keeps the picker inside a narrow WebUI viewport', async () => {
    render(<WebFsPicker options={{ properties: ['openDirectory'] }} onDone={vi.fn()} />);

    const dialog = await screen.findByRole('dialog');
    const modal = dialog.closest<HTMLElement>('.arco-modal');

    expect(modal?.style.width).toBe('calc(100vw - 32px)');
    expect(modal?.style.maxWidth).toBe('640px');
  });

  it('renders modal wrapper with z-index >= 10500 above TeamCreateModal', async () => {
    render(<WebFsPicker options={{ properties: ['openDirectory', 'createDirectory'] }} onDone={vi.fn()} />);

    const dialog = await screen.findByRole('dialog');
    const modalWrap = dialog.closest<HTMLElement>('.arco-modal-wrapper');

    expect(modalWrap?.style.zIndex).toBe('10500');
  });

  it('renders refresh and new folder buttons when directory mode is active', async () => {
    render(<WebFsPicker options={{ properties: ['openDirectory', 'createDirectory'] }} onDone={vi.fn()} />);

    expect(await screen.findByTitle('common.refresh')).toBeTruthy();
    expect(await screen.findByTitle('common.newFolder')).toBeTruthy();
  });

  it('omits new folder button in pure file selection mode', async () => {
    render(<WebFsPicker options={{ properties: ['openFile'] }} onDone={vi.fn()} />);

    expect(await screen.findByTitle('common.refresh')).toBeTruthy();
    expect(screen.queryByTitle('common.newFolder')).toBeNull();
  });
});
