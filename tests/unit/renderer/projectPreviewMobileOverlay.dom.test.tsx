/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  PreviewPanel: () => <div data-testid='preview-panel'>preview</div>,
}));

import { ProjectPreviewMobileOverlay } from '@/renderer/components/layout/ProjectPreviewMobileOverlay';

afterEach(() => cleanup());

describe('ProjectPreviewMobileOverlay', () => {
  it('renders the preview panel in a stable full-screen mobile host', () => {
    render(<ProjectPreviewMobileOverlay onClose={() => {}} />);

    const overlay = document.querySelector('[data-project-preview-mobile-overlay]') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.height).toBe('var(--app-viewport-height)');
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
  });

  it('closes when the mobile backdrop is tapped', () => {
    const onClose = vi.fn();
    render(<ProjectPreviewMobileOverlay onClose={onClose} />);

    fireEvent.click(document.querySelector('[data-project-preview-mobile-backdrop]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
