/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MessageText from '@/renderer/pages/conversation/Messages/components/MessageText';
import type { IMessageText } from '@/common/chat/chatLib';

const mockLocalFilePreview = vi.fn();

vi.mock('@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview', () => ({
  useLocalFilePreview: () => mockLocalFilePreview,
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'conv-123',
    workspace: '/workspace/project',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
  }),
}));

vi.mock('@/renderer/hooks/chat/useForkConversation', () => ({
  useForkConversation: () => vi.fn(),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  resolveAgentLogo: () => null,
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/pages/team/identity/TeamIdentityContext', () => ({
  useTeammateColor: () => undefined,
}));

vi.mock('@/renderer/components/media/FilePreview', () => ({
  __esModule: true,
  default: ({ path, onClick }: { path: string; onClick?: () => void }) => (
    <div data-testid='file-preview-chip' onClick={onClick}>
      {path}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('MessageText attachment trust boundary and rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects assistant plain strings, untyped path objects, and assistant markers', () => {
    const assistantMessage: IMessageText = {
      id: 'msg-assistant-1',
      conversation_id: 'conv-123',
      type: 'text',
      position: 'left',
      content: {
        content: 'I have generated your itinerary.\n\n__AIONUI_FILES__\noutput/itinerary.html',
        files: ['output/itinerary.html', '/etc/passwd'] as unknown as IMessageText['content']['files'],
        attachments: [
          { path: 'report.xlsx', name: 'report.xlsx' },
        ] as unknown as IMessageText['content']['attachments'],
      },
    };

    render(<MessageText message={assistantMessage} />);

    // Assistant untrusted attachments & markers must NOT render preview chips
    const chips = screen.queryAllByTestId('file-preview-chip');
    expect(chips).toHaveLength(0);
    expect(mockLocalFilePreview).not.toHaveBeenCalled();
  });

  it('renders and allows clicking client file uploads and user markers on user messages', () => {
    const userMessage: IMessageText = {
      id: 'msg-user-1',
      conversation_id: 'conv-123',
      type: 'text',
      position: 'right',
      content: {
        content: 'Uploading my report.\n\n__AIONUI_FILES__\ndocs/summary.md',
        files: ['data/sheet.xlsx'],
      },
    };

    render(<MessageText message={userMessage} />);

    const chips = screen.getAllByTestId('file-preview-chip');
    expect(chips).toHaveLength(2);

    fireEvent.click(chips[0]);
    expect(mockLocalFilePreview).toHaveBeenCalledWith('/workspace/project/data/sheet.xlsx');

    fireEvent.click(chips[1]);
    expect(mockLocalFilePreview).toHaveBeenCalledWith('/workspace/project/docs/summary.md');
  });
});
