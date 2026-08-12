/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { PreviewPanel } from '@/renderer/pages/conversation/Preview';
import React from 'react';

export type ProjectPreviewMobileOverlayProps = {
  onClose: () => void;
};

/** Full-screen mobile host for project-scoped file previews. */
export const ProjectPreviewMobileOverlay: React.FC<ProjectPreviewMobileOverlayProps> = ({ onClose }) => {
  return (
    <>
      <div
        data-project-preview-mobile-backdrop
        className='fixed inset-0 bg-black/30 z-90'
        onClick={onClose}
        aria-hidden='true'
      />
      <div
        data-project-preview-mobile-overlay
        className='!bg-1 fixed mobile-viewport-overlay preview-panel z-100 flex flex-col overflow-hidden'
        style={{
          inset: 0,
          height: 'var(--app-viewport-height)',
          border: '1px solid var(--bg-3)',
        }}
      >
        <PreviewPanel />
      </div>
    </>
  );
};
