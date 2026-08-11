/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extract public share token from location pathname or query string.
 * Matches /s/:token, /share/:token, /api/public/shares/:token, or ?token=:token
 */
export const extractShareTokenFromLocation = (pathname: string, search: string): string => {
  if (search) {
    const params = new URLSearchParams(search);
    const queryToken = params.get('token') || params.get('t');
    if (queryToken) return queryToken.trim();
  }

  const normalizedPath = (pathname || '').trim();
  const match = /\/(?:s|share|api\/public\/shares)\/([^/#?]+)/i.exec(normalizedPath);
  if (match && match[1]) {
    return decodeURIComponent(match[1]).trim();
  }

  return '';
};
