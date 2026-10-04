/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { teamUploadFileRef } from '@/common/types/chatFile';
import { createSetAtPath, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import type { FileSelectionUpdate } from '@/renderer/hooks/chat/useSendBoxFiles';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';

describe('useSendBoxFiles Team attachments', () => {
  it('keeps an opaque Team upload ref in the selected-file lane, never the generic path lane', () => {
    const selected: Array<string | FileOrFolderItem> = [];
    const setAtPath = vi.fn((update: FileSelectionUpdate) => {
      const nextSelection = typeof update === 'function' ? update(selected) : update;
      selected.splice(0, selected.length, ...nextSelection);
    });
    const setUploadFile = vi.fn();
    const { result } = renderHook(() =>
      useSendBoxFiles({
        atPath: [],
        uploadFile: [],
        setAtPath,
        setUploadFile,
      })
    );

    act(() => {
      result.current.handleFilesAdded([
        {
          name: 'diagram.png',
          path: 'diagram.png',
          size: 8,
          type: 'image/png',
          lastModified: 10,
          chatRef: teamUploadFileRef('opaque-upload-1'),
        },
      ]);
    });

    expect(selected).toEqual([
      {
        path: 'diagram.png',
        name: 'diagram.png',
        isFile: true,
        chatRef: { kind: 'team_upload', upload_id: 'opaque-upload-1' },
      },
    ]);
    expect(setUploadFile).not.toHaveBeenCalled();
  });

  it('retains Team refs when separate upload batches finish before a render through the draft setter', () => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState({ atPath: [] as Array<string | FileOrFolderItem> });
      const mutate = (update: (prev: Record<string, unknown> | undefined) => Record<string, unknown>) => {
        setDraft((prev) => update(prev as Record<string, unknown>) as typeof prev);
      };
      const setAtPath = createSetAtPath(mutate, draft);
      const [uploadFile, setUploadFile] = useState<string[]>([]);
      const files = useSendBoxFiles({ atPath: draft.atPath, uploadFile, setAtPath, setUploadFile });

      return { atPath: draft.atPath, files };
    });

    act(() => {
      result.current.files.handleFilesAdded([
        {
          name: 'first.png',
          path: 'first.png',
          size: 8,
          type: 'image/png',
          lastModified: 10,
          chatRef: teamUploadFileRef('opaque-upload-1'),
        },
      ]);
      result.current.files.handleFilesAdded([
        {
          name: 'second.png',
          path: 'second.png',
          size: 9,
          type: 'image/png',
          lastModified: 11,
          chatRef: teamUploadFileRef('opaque-upload-2'),
        },
      ]);
    });

    expect(result.current.atPath).toMatchObject([
      { path: 'first.png', chatRef: { kind: 'team_upload', upload_id: 'opaque-upload-1' } },
      { path: 'second.png', chatRef: { kind: 'team_upload', upload_id: 'opaque-upload-2' } },
    ]);
  });

  it('starts from an empty selection when the draft has not loaded yet', () => {
    let selection: Array<string | FileOrFolderItem> = [];
    const mutate = vi.fn((update: (prev: Record<string, unknown> | undefined) => Record<string, unknown>) => {
      selection = update(undefined).atPath as Array<string | FileOrFolderItem>;
    });
    const { result } = renderHook(() => createSetAtPath(mutate, undefined));

    act(() => {
      result.current((previous) => [...previous, 'diagram.png']);
    });

    expect(selection).toEqual(['diagram.png']);
  });
});
