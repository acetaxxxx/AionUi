/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PUBLIC_SHARE_HOST,
  buildPublicShareUrl,
  getPublicShareHost,
  isSafeLocalImagePath,
  processMarkdownShareAssets,
  publishMarkdownShare,
  sanitizeMarkdownForShare,
} from './markdownSharePublish';

describe('markdownSharePublish', () => {
  describe('getPublicShareHost', () => {
    it('defaults to DEFAULT_PUBLIC_SHARE_HOST', () => {
      expect(getPublicShareHost()).toBe(DEFAULT_PUBLIC_SHARE_HOST);
    });
  });

  describe('buildPublicShareUrl', () => {
    it('builds canonical share URL using public host and token', () => {
      expect(buildPublicShareUrl('abc123token')).toBe('https://share.snoozydoggy.com/s/abc123token');
      expect(buildPublicShareUrl('tok-1', 'https://custom.share.domain')).toBe('https://custom.share.domain/s/tok-1');
    });
  });

  describe('isSafeLocalImagePath', () => {
    it('allows valid relative and absolute image paths', () => {
      expect(isSafeLocalImagePath('logo.png')).toBe(true);
      expect(isSafeLocalImagePath('./assets/diagram.jpg')).toBe(true);
      expect(isSafeLocalImagePath('images/photo.webp')).toBe(true);
      expect(isSafeLocalImagePath('images/photo.svg')).toBe(false);
    });

    it('rejects remote URLs, inline data URLs, file:// scheme, and path traversal', () => {
      expect(isSafeLocalImagePath('https://example.com/a.png')).toBe(false);
      expect(isSafeLocalImagePath('data:image/png;base64,AAAA')).toBe(false);
      expect(isSafeLocalImagePath('file:///etc/passwd.png')).toBe(false);
      expect(isSafeLocalImagePath('../../secret/pass.png', '/workspace/docs')).toBe(false);
      expect(isSafeLocalImagePath('script.js')).toBe(false);
    });
  });

  describe('processMarkdownShareAssets', () => {
    it('resolves safe local image files into base64 asset payloads and rewrites Markdown links', async () => {
      const markdown = '# Doc\n\n![Logo](./logo.png)\n![Remote](https://example.com/a.png)';
      const resolveImageFn = vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('logo.png')) {
          return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        }
        return null;
      });

      const result = await processMarkdownShareAssets(markdown, {
        filePath: '/workspace/docs/readme.md',
        resolveImageFn,
      });

      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].name).toBe('logo.png');
      expect(result.assets[0].mime).toBe('image/png');
      expect(result.assets[0].data).toBeTruthy();

      expect(result.sanitizedMarkdown).toContain('![Logo](logo.png)');
      expect(result.sanitizedMarkdown).toContain('![Remote](https://example.com/a.png)');
    });

    it('sanitizes unresolvable local image links without exposing absolute paths', async () => {
      const markdown = '![Missing](/Users/secret/missing.png)';
      const resolveImageFn = vi.fn().mockResolvedValue(null);

      const result = await processMarkdownShareAssets(markdown, { resolveImageFn });
      expect(result.assets).toHaveLength(0);
      expect(result.sanitizedMarkdown).toBe('![Missing](image)');
      expect(result.sanitizedMarkdown).not.toContain('/Users/secret');
    });
  });

  describe('sanitizeMarkdownForShare', () => {
    it('preserves data:image and remote https images while sanitizing local file paths', () => {
      const markdown = [
        '# Title',
        '![Remote](https://example.com/a.png)',
        '![Data](data:image/png;base64,iVBORw0KGg...)',
        '![Local](/Users/alice/Secret/diagram.png)',
        '![WinLocal](C:\\Users\\Bob\\photo.jpg)',
        '![SchemeLocal](file:///var/tmp/img.png)',
      ].join('\n');

      const sanitized = sanitizeMarkdownForShare(markdown);
      expect(sanitized).toContain('![Remote](https://example.com/a.png)');
      expect(sanitized).toContain('![Data](data:image/png;base64,iVBORw0KGg...)');
      expect(sanitized).toContain('![Local](image)');
      expect(sanitized).toContain('![WinLocal](image)');
      expect(sanitized).toContain('![SchemeLocal](image)');
      expect(sanitized).not.toContain('/Users/alice');
      expect(sanitized).not.toContain('C:\\Users\\Bob');
    });
  });

  describe('publishMarkdownShare', () => {
    it('POSTs to /api/shares/markdown with credentials: include and asset payloads', async () => {
      const mockResponse = {
        token: 'share-token-xyz',
        id: 'share-id-1',
        title: 'My Notes',
        expiresAt: '2026-08-18T00:00:00.000Z',
      };

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      } as Response);

      const resolveImageFn = vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('chart.png')) {
          return 'data:image/png;base64,AAAA';
        }
        return null;
      });

      const result = await publishMarkdownShare('# My Notes\n\n![Chart](./chart.png)', 'My Notes', {
        fetchFn,
        filePath: '/workspace/docs/notes.md',
        resolveImageFn,
        appHostUrl: 'https://app.aionui.com',
        publicHostUrl: 'https://share.snoozydoggy.com',
      });

      expect(result.token).toBe('share-token-xyz');
      expect(result.shareUrl).toBe('https://share.snoozydoggy.com/s/share-token-xyz');
      expect(fetchFn).toHaveBeenCalledWith('https://app.aionui.com/api/shares/markdown', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'My Notes',
          markdown: '# My Notes\n\n![Chart](chart.png)',
          assets: [{ name: 'chart.png', mime: 'image/png', data: 'AAAA' }],
        }),
      });
    });

    it('throws error when response is not ok', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(publishMarkdownShare('# Content', 'Doc', { fetchFn })).rejects.toThrow(
        'Failed to publish share: HTTP 500'
      );
    });
  });
});
