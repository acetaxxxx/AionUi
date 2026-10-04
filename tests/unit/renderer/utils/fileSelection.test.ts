/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { teamUploadFileRef } from '@/common/types/chatFile';
import { mergeFileSelectionItems, stripWindowsVerbatimPrefix } from '@/renderer/utils/file/fileSelection';

describe('mergeFileSelectionItems Team uploads', () => {
  it('deduplicates by opaque identity rather than display filename', () => {
    const first = { path: 'photo.png', name: 'photo.png', isFile: true, chatRef: teamUploadFileRef('upload-1') };
    const second = { path: 'photo.png', name: 'photo.png', isFile: true, chatRef: teamUploadFileRef('upload-2') };

    expect(mergeFileSelectionItems([first], [second])).toEqual([first, second]);
    expect(mergeFileSelectionItems([first], [first])).toEqual([first]);
  });
});

// Regression for issue #3191: the WebUI directory picker backend used to
// return Windows extended-length (verbatim) paths like `\\?\C:\DEV`, which
// broke Claude Code spawning and duplicated project-list entries.
describe('stripWindowsVerbatimPrefix', () => {
  it('strips the verbatim disk prefix', () => {
    expect(stripWindowsVerbatimPrefix('\\\\?\\C:\\DEV\\project')).toBe('C:\\DEV\\project');
    expect(stripWindowsVerbatimPrefix('\\\\?\\C:\\')).toBe('C:\\');
  });

  it('rewrites the verbatim UNC prefix to a regular UNC path', () => {
    expect(stripWindowsVerbatimPrefix('\\\\?\\UNC\\server\\share\\dir')).toBe('\\\\server\\share\\dir');
  });

  it('leaves non-verbatim paths untouched', () => {
    expect(stripWindowsVerbatimPrefix('C:\\DEV\\project')).toBe('C:\\DEV\\project');
    expect(stripWindowsVerbatimPrefix('\\\\server\\share')).toBe('\\\\server\\share');
    expect(stripWindowsVerbatimPrefix('/home/user/project')).toBe('/home/user/project');
    expect(stripWindowsVerbatimPrefix('')).toBe('');
  });
});
