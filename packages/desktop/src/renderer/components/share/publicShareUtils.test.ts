/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  PublicShareError,
  buildPublicAssetUrl,
  fetchPublicShare,
  formatAssetSize,
  formatShareDate,
  isShareExpired,
  rewritePublicShareMarkdown,
} from './publicShareUtils';

describe('publicShareUtils', () => {
  describe('buildPublicAssetUrl', () => {
    it('builds canonical public asset URL', () => {
      expect(buildPublicAssetUrl('token123', 'asset456')).toBe('/s/token123/assets/asset456');
      expect(buildPublicAssetUrl('token123', 'asset456', 'https://share.example.com')).toBe(
        'https://share.example.com/s/token123/assets/asset456'
      );
    });
  });

  describe('rewritePublicShareMarkdown', () => {
    it('rewrites image references matching asset name or id', () => {
      const markdown = '# Test\n\n![Logo](logo.png)\n![Diagram](/assets/diagram.png)';
      const assets = [
        { id: 'uuid-1', name: 'logo.png', mime: 'image/png', size: 100 },
        { id: 'uuid-2', name: 'diagram.png', mime: 'image/png', size: 200 },
      ];

      const rewritten = rewritePublicShareMarkdown(markdown, 'my-token', assets, 'https://share.example.com');
      expect(rewritten).toContain('![Logo](https://share.example.com/s/my-token/assets/uuid-1)');
      expect(rewritten).toContain('![Diagram](https://share.example.com/s/my-token/assets/uuid-2)');
    });

    it('ignores external HTTP and inline data URLs', () => {
      const markdown = '![ext](https://example.com/a.png)\n![data](data:image/png;base64,AAAA)';
      const assets = [{ id: 'uuid-1', name: 'a.png', mime: 'image/png', size: 100 }];

      const rewritten = rewritePublicShareMarkdown(markdown, 'my-token', assets);
      expect(rewritten).toBe(markdown);
    });
  });

  describe('isShareExpired', () => {
    it('returns true for past dates and false for future/empty dates', () => {
      expect(isShareExpired('')).toBe(false);
      expect(isShareExpired(new Date(Date.now() - 10000).toISOString())).toBe(true);
      expect(isShareExpired(new Date(Date.now() + 100000).toISOString())).toBe(false);
    });
  });

  describe('formatAssetSize', () => {
    it('formats bytes correctly', () => {
      expect(formatAssetSize(500)).toBe('500 B');
      expect(formatAssetSize(2048)).toBe('2.0 KB');
      expect(formatAssetSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('formatShareDate', () => {
    it('handles valid and invalid date strings gracefully', () => {
      expect(formatShareDate('')).toBe('');
      expect(formatShareDate('invalid')).toBe('invalid');
      expect(formatShareDate('2026-08-11T00:00:00.000Z')).toBeTruthy();
    });
  });

  describe('fetchPublicShare', () => {
    it('fetches and parses valid public share without credentials', async () => {
      const mockPayload = {
        id: 'share-1',
        title: 'My Notes',
        markdown: '# Content',
        assets: [{ id: 'ast-1', name: 'img.png', mime: 'image/png', size: 50 }],
        createdAt: '2026-08-11T00:00:00.000Z',
        expiresAt: '2026-08-18T00:00:00.000Z',
      };

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPayload,
      } as Response);

      const share = await fetchPublicShare('valid-token', { fetchFn, baseUrl: 'https://share.com' });
      expect(share.id).toBe('share-1');
      expect(share.title).toBe('My Notes');
      expect(fetchFn).toHaveBeenCalledWith('https://share.com/s/valid-token', {
        method: 'GET',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
    });

    it('throws NOT_FOUND error on 404', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(fetchPublicShare('missing-token', { fetchFn })).rejects.toThrow(PublicShareError);
    });

    it('throws EXPIRED error on 410', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
      } as Response);

      await expect(fetchPublicShare('expired-token', { fetchFn })).rejects.toThrow(PublicShareError);
    });
  });
});
