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
    it('POSTs to /api/shares/markdown with credentials: include and returns share URL', async () => {
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

      const result = await publishMarkdownShare('# My Notes', 'My Notes', {
        fetchFn,
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
          markdown: '# My Notes',
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
