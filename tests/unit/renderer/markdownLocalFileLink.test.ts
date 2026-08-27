/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveLocalFileLinkPath,
  resolveLocalFileLinkReference,
  toLocalFileHref,
} from '@/renderer/components/Markdown/markdownUtils';

describe('resolveLocalFileLinkPath and security checks', () => {
  const originalLocation = globalThis.window?.location;

  beforeEach(() => {
    // Setup standard app origin for exact-origin tests
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://ai-chat.snoozydoggy.com',
          protocol: 'https:',
          host: 'ai-chat.snoozydoggy.com',
          hostname: 'ai-chat.snoozydoggy.com',
          port: '',
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalLocation) {
      globalThis.window.location = originalLocation;
    }
  });

  it('recognizes Windows absolute paths emitted as root-relative markdown links', () => {
    expect(resolveLocalFileLinkPath('/C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx'
    );
  });

  it('recognizes encoded file URLs', () => {
    expect(resolveLocalFileLinkPath('file:///C:/Users/Administrator/%E7%9C%8B%E6%9D%BF.xlsx')).toBe(
      'C:/Users/Administrator/看板.xlsx'
    );
  });

  it('recognizes common POSIX absolute paths', () => {
    expect(resolveLocalFileLinkPath('/Users/demo/outputs/report.xlsx')).toBe('/Users/demo/outputs/report.xlsx');
  });

  it('recognizes file-like POSIX absolute paths outside common home and temp roots', () => {
    expect(resolveLocalFileLinkPath('/opt/aionui/outputs/report.xlsx')).toBe('/opt/aionui/outputs/report.xlsx');
  });

  it('recognizes line suffixes without confusing Windows drive letters', () => {
    const reference = resolveLocalFileLinkReference('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421');

    expect(reference).toEqual({
      filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421',
      line: 1421,
    });
  });

  it('recognizes line and column suffixes without including the line in the file path', () => {
    const reference = resolveLocalFileLinkReference(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7'
    );

    expect(reference).toEqual({
      filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7',
      line: 1421,
      column: 7,
    });
  });

  it('recognizes POSIX hash line references', () => {
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10-L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });
  });

  it('recognizes file URL hash line references and normalizes raw references', () => {
    expect(resolveLocalFileLinkReference('file:///Users/demo/file.ts#L10')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10',
      line: 10,
    });
  });

  it('recognizes Windows file URL hash lines and ranges', () => {
    expect(resolveLocalFileLinkReference('file:///C:/Users/demo/file.ts#L10')).toEqual({
      filePath: 'C:/Users/demo/file.ts',
      rawReference: 'C:/Users/demo/file.ts#L10',
      line: 10,
    });
  });

  it('recognizes aion-file custom protocol URLs', () => {
    expect(resolveLocalFileLinkReference('aion-file:///workspace/output.html#L25')).toEqual({
      filePath: '/workspace/output.html',
      rawReference: '/workspace/output.html#L25',
      line: 25,
    });
  });

  describe('Strict same-origin & trusted route handling', () => {
    it('accepts exact same-origin links with explicit trusted routes and parameters', () => {
      expect(
        resolveLocalFileLinkReference('https://ai-chat.snoozydoggy.com/preview?file=/workspace/report.html#L10')
      ).toEqual({
        filePath: '/workspace/report.html',
        rawReference: '/workspace/report.html#L10',
        line: 10,
      });

      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/api/fs/content?path=/workspace/data.csv')).toBe(
        '/workspace/data.csv'
      );

      expect(
        resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/api/fs/stream?relative_path=docs/summary.md')
      ).toBe('docs/summary.md');
    });

    it('rejects links with origin port mismatch', () => {
      // Current origin: https://ai-chat.snoozydoggy.com
      expect(
        resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com:8080/preview?file=/workspace/report.html')
      ).toBeNull();

      // Switch to localhost:3000
      globalThis.window.location.origin = 'http://localhost:3000';
      expect(resolveLocalFileLinkPath('http://localhost:8080/preview?file=/workspace/report.html')).toBeNull();
      expect(resolveLocalFileLinkPath('http://127.0.0.1:3000/preview?file=/workspace/report.html')).toBeNull();
      expect(resolveLocalFileLinkPath('http://localhost:3000/preview?file=/workspace/report.html')).toBe(
        '/workspace/report.html'
      );
    });

    it('rejects links with origin scheme mismatch', () => {
      // Current origin is https://ai-chat.snoozydoggy.com
      expect(resolveLocalFileLinkPath('http://ai-chat.snoozydoggy.com/preview?file=/workspace/report.html')).toBeNull();
    });

    it('rejects same-origin arbitrary endpoints and static file routes', () => {
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/api/users?file=report.html')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/foo.html')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/workspace/output.html')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/images/logo.png')).toBeNull();
    });

    it('rejects directory traversal in same-origin URLs and aion-file URLs', () => {
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/preview?file=../../etc/passwd')).toBeNull();
      expect(
        resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/api/fs/content?path=/workspace/../../etc/shadow')
      ).toBeNull();
      expect(resolveLocalFileLinkPath('aion-file:///../../etc/passwd')).toBeNull();
      expect(resolveLocalFileLinkPath('file:///etc/../../secret.txt')).toBeNull();
    });

    it('rejects untrusted or missing query parameters', () => {
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/preview?random=report.html')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/preview')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/api/fs/content')).toBeNull();
    });

    it('does not treat normal external HTTPS web links or bare SPA roots as local files', () => {
      expect(resolveLocalFileLinkPath('https://aionui.com/docs')).toBeNull();
      expect(resolveLocalFileLinkPath('https://google.com')).toBeNull();
      expect(resolveLocalFileLinkPath('https://github.com/aionui/aionui')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/settings')).toBeNull();
      expect(resolveLocalFileLinkPath('https://ai-chat.snoozydoggy.com/chat')).toBeNull();
      expect(resolveLocalFileLinkPath('/settings')).toBeNull();
      expect(resolveLocalFileLinkPath('/chat')).toBeNull();
    });
  });

  it('formats local file paths as file URLs for browser link copying', () => {
    expect(toLocalFileHref('C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx')).toBe(
      'file:///C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx'
    );
    expect(toLocalFileHref('/var/folders/demo/report.xlsx')).toBe('file:///var/folders/demo/report.xlsx');
  });
});
