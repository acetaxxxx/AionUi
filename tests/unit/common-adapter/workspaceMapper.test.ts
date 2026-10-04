/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  fromBackendDirOrFileList,
  fromBackendWorkspaceFlatFiles,
  type RawWorkspaceFlatFile,
} from '@/common/adapter/workspaceMapper';

describe('workspaceMapper', () => {
  it('normalizes snake_case directory entries and nested entries to the UI shape', () => {
    expect(
      fromBackendDirOrFileList([
        {
          name: 'src',
          full_path: '/workspace/src',
          relative_path: 'src',
          is_dir: true,
          is_file: false,
          children: [
            {
              name: 'main.ts',
              full_path: '/workspace/src/main.ts',
              relative_path: 'src/main.ts',
              is_dir: false,
              is_file: true,
            },
          ],
        },
      ])
    ).toEqual([
      {
        name: 'src',
        fullPath: '/workspace/src',
        relativePath: 'src',
        isDir: true,
        isFile: false,
        children: [
          {
            name: 'main.ts',
            fullPath: '/workspace/src/main.ts',
            relativePath: 'src/main.ts',
            isDir: false,
            isFile: true,
            children: undefined,
          },
        ],
      },
    ]);
  });

  it('maps workspace flat files from backend snake_case to frontend camelCase', () => {
    const raw: RawWorkspaceFlatFile[] = [
      {
        name: 'main.ts',
        full_path: '/workspace/src/main.ts',
        relative_path: 'src/main.ts',
      },
    ];

    expect(fromBackendWorkspaceFlatFiles(raw)).toEqual([
      {
        name: 'main.ts',
        fullPath: '/workspace/src/main.ts',
        relativePath: 'src/main.ts',
      },
    ]);
  });

  it('does not leak snake_case path fields', () => {
    const [file] = fromBackendWorkspaceFlatFiles([
      {
        name: 'README.md',
        full_path: '/workspace/README.md',
        relative_path: 'README.md',
      },
    ]);

    expect(file).toBeDefined();
    expect((file as Record<string, unknown>).full_path).toBeUndefined();
    expect((file as Record<string, unknown>).relative_path).toBeUndefined();
    expect(file?.fullPath).toBe('/workspace/README.md');
    expect(file?.relativePath).toBe('README.md');
  });
});
