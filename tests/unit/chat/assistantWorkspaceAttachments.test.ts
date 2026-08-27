/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseFileMarker,
  resolveMessageFilePath,
  extractMessageFiles,
  isValidWorkspaceRelativePath,
  validateUserFileReference,
} from '@/renderer/utils/chat/messageParser';

describe('Assistant workspace-file references and attachments security gate', () => {
  describe('isValidWorkspaceRelativePath validation', () => {
    it('accepts safe workspace-relative paths', () => {
      expect(isValidWorkspaceRelativePath('output/itinerary.html')).toBe(true);
      expect(isValidWorkspaceRelativePath('docs/summary.md')).toBe(true);
      expect(isValidWorkspaceRelativePath('report.xlsx')).toBe(true);
      expect(isValidWorkspaceRelativePath('./nested/file.ts')).toBe(true);
    });

    it('rejects raw absolute host paths', () => {
      expect(isValidWorkspaceRelativePath('/etc/passwd')).toBe(false);
      expect(isValidWorkspaceRelativePath('/root/.ssh/id_rsa')).toBe(false);
      expect(isValidWorkspaceRelativePath('/Users/demo/secret.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('C:/Windows/system32/cmd.exe')).toBe(false);
      expect(isValidWorkspaceRelativePath('D:\\Data\\secret.docx')).toBe(false);
      expect(isValidWorkspaceRelativePath('\\\\server\\share\\file.txt')).toBe(false);
    });

    it('rejects standard and percent-decoded path traversal attempts (../, %2e%2e)', () => {
      expect(isValidWorkspaceRelativePath('../secret.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('../../etc/shadow')).toBe(false);
      expect(isValidWorkspaceRelativePath('output/../../secret.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('docs/..\\..\\secret.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('%2e%2e/secret.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('output/%2e%2e/%2e%2e/etc/passwd')).toBe(false);
      expect(isValidWorkspaceRelativePath('output/%2E%2E/secret.txt')).toBe(false);
    });

    it('rejects file URLs and external schemes', () => {
      expect(isValidWorkspaceRelativePath('file:///etc/passwd')).toBe(false);
      expect(isValidWorkspaceRelativePath('http://evil.com/payload.js')).toBe(false);
      expect(isValidWorkspaceRelativePath('https://evil.com/doc.pdf')).toBe(false);
      expect(isValidWorkspaceRelativePath('javascript:alert(1)')).toBe(false);
    });

    it('rejects empty, whitespace, and null-byte paths (\\0, %00)', () => {
      expect(isValidWorkspaceRelativePath('')).toBe(false);
      expect(isValidWorkspaceRelativePath('   ')).toBe(false);
      expect(isValidWorkspaceRelativePath('foo\0bar.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('foo%00bar.txt')).toBe(false);
      expect(isValidWorkspaceRelativePath('foo%2500bar.txt')).toBe(false);
    });
  });

  describe('extractMessageFiles sender trust boundary', () => {
    it('assistant message: strictly rejects assistant files, attachments, markers, and shape-only objects', () => {
      const assistantContent = {
        content: 'Here is the report.\n\n__AIONUI_FILES__\noutput/marker_file.html',
        files: [
          { kind: 'project', pe_id: 'p1', relative_path: 'docs/summary.md' }, // Shape-only project ref -> REJECTED
          { kind: 'local', path: 'output/itinerary.html' }, // Shape-only local ref -> REJECTED
          'untyped/plain_string.html', // Plain string -> REJECTED
          '/etc/passwd', // Raw absolute host path -> REJECTED
          '../escape.txt', // Traversal path -> REJECTED
        ],
        attachments: [
          {
            name: 'sheet.xlsx',
            fileRef: { kind: 'local', path: 'data/sheet.xlsx' },
          }, // Untrusted assistant attachment -> REJECTED
          { path: 'untyped/attachment.pdf' }, // Untyped attachment -> REJECTED
        ],
      };

      const extracted = extractMessageFiles(assistantContent, ['output/marker_file.html'], { isUserMessage: false });

      // Safest current contract: assistant messages yield 0 preview files until trusted backend provenance exists
      expect(extracted).toEqual([]);
    });

    it('user message: accepts user-uploaded files and user markers', () => {
      const userContent = {
        content: 'My uploaded files',
        files: ['user/upload.pdf', { path: 'user/document.docx' }],
        attachments: [{ path: 'user/attachment.xlsx' }],
      };

      const extracted = extractMessageFiles(userContent, ['user/marker.png'], { isUserMessage: true });

      expect(extracted).toEqual(['user/upload.pdf', 'user/document.docx', 'user/attachment.xlsx', 'user/marker.png']);
    });
  });

  describe('parseFileMarker security gate', () => {
    it('preserves the entire marker block when any trailing line is not a safe relative path', () => {
      const rawContent = `Here is your report:

__AIONUI_FILES__
output/itinerary.html
/etc/passwd
../escape.txt
C:/Windows/win.ini
docs/summary.md`;

      const { text, files } = parseFileMarker(rawContent, true);

      expect(text).toBe(rawContent);
      expect(files).toEqual([]);
    });
  });

  describe('resolveMessageFilePath containment', () => {
    it('resolves validated relative paths strictly contained within workspace root', () => {
      const workspace = '/workspace/project';
      expect(resolveMessageFilePath('output/itinerary.html', workspace)).toBe(
        '/workspace/project/output/itinerary.html'
      );
      expect(resolveMessageFilePath('./docs/guide.md', workspace)).toBe('/workspace/project/docs/guide.md');
    });

    it('returns null for traversal attempts, absolute paths, and missing workspace', () => {
      const workspace = '/workspace/project';
      expect(resolveMessageFilePath('/etc/passwd', workspace)).toBeNull();
      expect(resolveMessageFilePath('C:/Windows/win.ini', workspace)).toBeNull();
      expect(resolveMessageFilePath('../escape.txt', workspace)).toBeNull();
      expect(resolveMessageFilePath('docs/../../escape.txt', workspace)).toBeNull();
      expect(resolveMessageFilePath('file:///etc/passwd', workspace)).toBeNull();
      expect(resolveMessageFilePath('output/itinerary.html', '')).toBeNull();
      expect(resolveMessageFilePath('output/itinerary.html', undefined)).toBeNull();
    });
  });
});
