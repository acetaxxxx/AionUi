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
import { useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';

describe('useSendBoxFiles Team attachments', () => {
  it('keeps an opaque Team upload ref in the selected-file lane, never the generic path lane', () => {
    const setAtPath = vi.fn();
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

    expect(setAtPath).toHaveBeenCalledWith([
      {
        path: 'diagram.png',
        name: 'diagram.png',
        isFile: true,
        chatRef: { kind: 'team_upload', upload_id: 'opaque-upload-1' },
      },
    ]);
    expect(setUploadFile).not.toHaveBeenCalled();
  });

  it('retains Team refs when separate upload batches finish before a render', () => {
    const { result } = renderHook(() => {
      const [atPath, setAtPath] = useState<Array<string | FileOrFolderItem>>([]);
      const [uploadFile, setUploadFile] = useState<string[]>([]);
      const files = useSendBoxFiles({ atPath, uploadFile, setAtPath, setUploadFile });

      return { atPath, files };
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
});
