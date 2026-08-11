/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { extractShareTokenFromLocation } from './shareMainUtils';

describe('extractShareTokenFromLocation', () => {
  it('extracts token from /s/:token path', () => {
    expect(extractShareTokenFromLocation('/s/token-123', '')).toBe('token-123');
    expect(extractShareTokenFromLocation('/s/abc%20def', '')).toBe('abc def');
  });

  it('extracts token from /share/:token path', () => {
    expect(extractShareTokenFromLocation('/share/token-456', '')).toBe('token-456');
  });

  it('extracts token from /api/public/shares/:token path', () => {
    expect(extractShareTokenFromLocation('/api/public/shares/token-789', '')).toBe('token-789');
  });

  it('extracts token from query string ?token=... or ?t=...', () => {
    expect(extractShareTokenFromLocation('/', '?token=my-query-token')).toBe('my-query-token');
    expect(extractShareTokenFromLocation('/s/ignore', '?token=override-token')).toBe('override-token');
    expect(extractShareTokenFromLocation('/', '?t=short-token')).toBe('short-token');
  });

  it('returns empty string if no valid token found', () => {
    expect(extractShareTokenFromLocation('/', '')).toBe('');
    expect(extractShareTokenFromLocation('/about', '')).toBe('');
  });
});
