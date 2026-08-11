/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { fetchPublicShare } from './publicShareUtils';

describe('PublicShareViewer integration logic', () => {
  it('correctly handles 200 OK snapshot payload with assets', async () => {
    const mockPayload = {
      id: 'share-99',
      title: 'Shared Project Spec',
      markdown: '# Overview\n\n![Architecture](arch.png)',
      assets: [{ id: 'asset-77', name: 'arch.png', mime: 'image/png', size: 1024 }],
      createdAt: '2026-08-11T00:00:00.000Z',
      expiresAt: '2026-08-25T00:00:00.000Z',
    };

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload,
    } as Response);

    const share = await fetchPublicShare('tok-abc', { fetchFn, baseUrl: 'https://share.aionui.com' });
    expect(share.title).toBe('Shared Project Spec');
    expect(share.assets).toHaveLength(1);
    expect(share.assets[0].id).toBe('asset-77');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://share.aionui.com/api/public/shares/tok-abc',
      expect.objectContaining({ credentials: 'omit' })
    );
  });

  it('handles 404 Not Found response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(fetchPublicShare('missing-tok', { fetchFn })).rejects.toThrow('Share not found or has been revoked');
  });

  it('handles 410 Expired response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
    } as Response);

    await expect(fetchPublicShare('expired-tok', { fetchFn })).rejects.toThrow('Share has expired');
  });
});
