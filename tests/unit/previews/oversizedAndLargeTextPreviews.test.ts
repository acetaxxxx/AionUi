/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  resolvePreviewPayload,
  HTML_MARKDOWN_PREVIEW_MAX_BYTES,
  DEFAULT_TEXT_PREVIEW_LIMIT_MB,
} from '@/renderer/utils/file/previewPayload';
import type { ChatFileRef } from '@/common/types/chatFile';

const getContentMetadataMock = vi.fn();
const readContentMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getContentMetadata: {
        invoke: (args: unknown) => getContentMetadataMock(args),
      },
      readContent: {
        invoke: (args: unknown) => readContentMock(args),
      },
    },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: vi.fn().mockResolvedValue(undefined),
}));

describe('resolvePreviewPayload for large HTML/Markdown and distinct states', () => {
  it('allows HTML files above 1 MB to remain previewable with full utf8 content', async () => {
    const fileRef: ChatFileRef = { kind: 'local', path: '/workspace/big_report.html' };
    const htmlContent = '<html><body><h1>Large Generated Report</h1><p>' + 'a'.repeat(2 * 1024 * 1024) + '</p></body></html>';
    getContentMetadataMock.mockResolvedValueOnce({
      size: 2 * 1024 * 1024 + 100, // ~2 MB
      lastModified: 1700000000,
    });
    readContentMock.mockResolvedValueOnce(htmlContent);

    const payload = await resolvePreviewPayload(fileRef, 'html');

    expect(payload.oversized).toBe(false);
    expect(payload.content).toBe(htmlContent);
    expect(payload.isOverTextEditLimit).toBe(true);
    expect(payload.thresholdBytes).toBe(HTML_MARKDOWN_PREVIEW_MAX_BYTES);
    expect(readContentMock).toHaveBeenCalledWith({ file: fileRef, encoding: 'utf8' });
  });

  it('allows Markdown files above 1 MB to remain previewable with full utf8 content', async () => {
    const fileRef: ChatFileRef = { kind: 'project', pe_id: 'pe1', relative_path: 'large_doc.md' };
    const mdContent = '# Markdown document\n' + 'line\n'.repeat(500000);
    getContentMetadataMock.mockResolvedValueOnce({
      size: 3 * 1024 * 1024, // 3 MB
      lastModified: 1700000000,
    });
    readContentMock.mockResolvedValueOnce(mdContent);

    const payload = await resolvePreviewPayload(fileRef, 'markdown');

    expect(payload.oversized).toBe(false);
    expect(payload.content).toBe(mdContent);
    expect(payload.isOverTextEditLimit).toBe(true);
  });

  it('marks HTML/Markdown exceeding 20 MB as oversized (too-large state)', async () => {
    const fileRef: ChatFileRef = { kind: 'local', path: '/workspace/huge.html' };
    getContentMetadataMock.mockResolvedValueOnce({
      size: 25 * 1024 * 1024, // 25 MB
      lastModified: 1700000000,
    });

    const payload = await resolvePreviewPayload(fileRef, 'html');

    expect(payload.oversized).toBe(true);
    expect(payload.content).toBe('');
    expect(payload.sizeBytes).toBe(25 * 1024 * 1024);
  });

  it('marks raw code files above standard limit (1 MB) as oversized without reading content', async () => {
    const fileRef: ChatFileRef = { kind: 'local', path: '/workspace/large.ts' };
    getContentMetadataMock.mockResolvedValueOnce({
      size: 2 * 1024 * 1024, // 2 MB
      lastModified: 1700000000,
    });

    const payload = await resolvePreviewPayload(fileRef, 'code');

    expect(payload.oversized).toBe(true);
    expect(payload.content).toBe('');
    expect(payload.thresholdBytes).toBe(DEFAULT_TEXT_PREVIEW_LIMIT_MB * 1024 * 1024);
  });

  it('handles content-free types like unsupported without reading content', async () => {
    const fileRef: ChatFileRef = { kind: 'local', path: '/workspace/archive.zip' };
    getContentMetadataMock.mockResolvedValueOnce({
      size: 50 * 1024 * 1024,
      lastModified: 1700000000,
    });

    const payload = await resolvePreviewPayload(fileRef, 'unsupported');

    expect(payload.oversized).toBe(false);
    expect(payload.thresholdBytes).toBeUndefined();
    expect(payload.content).toBe('');
  });

  it('throws error when file is unavailable/missing (distinct unavailable state)', async () => {
    const fileRef: ChatFileRef = { kind: 'local', path: '/workspace/nonexistent.html' };
    getContentMetadataMock.mockRejectedValueOnce(new Error('ENOENT: file not found'));

    await expect(resolvePreviewPayload(fileRef, 'html')).rejects.toThrow('ENOENT');
  });
});
