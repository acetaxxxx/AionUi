/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ShareAsset = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export type PublicShare = {
  id: string;
  title: string;
  markdown: string;
  assets: ShareAsset[];
  createdAt: string;
  expiresAt: string;
};

export class PublicShareError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'EXPIRED' | 'FETCH_FAILED' | 'INVALID_PAYLOAD',
    public readonly status: number,
    message?: string
  ) {
    super(message || code);
    this.name = 'PublicShareError';
  }
}

/**
 * Format bytes into human-readable size string.
 */
export const formatAssetSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Format ISO timestamp string into readable date string.
 */
export const formatShareDate = (isoString?: string): string => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
};

/**
 * Check whether a share has passed its expiration timestamp.
 */
export const isShareExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= Date.now();
};

/**
 * Build canonical asset URL for a public share asset.
 */
export const buildPublicAssetUrl = (token: string, assetId: string, baseUrl: string = ''): string => {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/s/${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}`;
};

/**
 * Rewrite Markdown image references to canonical public share asset URLs.
 * Matches asset names, asset IDs, relative asset paths, or existing placeholder URLs.
 */
export const rewritePublicShareMarkdown = (
  markdown: string,
  token: string,
  assets: ShareAsset[] = [],
  baseUrl: string = ''
): string => {
  if (!markdown || !token) return markdown || '';
  if (!assets.length) return markdown;

  // Build name/id to asset URL map
  const nameToUrlMap = new Map<string, string>();
  for (const asset of assets) {
    const url = buildPublicAssetUrl(token, asset.id, baseUrl);
    if (asset.id) nameToUrlMap.set(asset.id, url);
    if (asset.name) {
      nameToUrlMap.set(asset.name, url);
      nameToUrlMap.set(asset.name.toLowerCase(), url);
      nameToUrlMap.set(`assets/${asset.name}`, url);
      nameToUrlMap.set(`/assets/${asset.name}`, url);
      nameToUrlMap.set(`./assets/${asset.name}`, url);
      nameToUrlMap.set(`./${asset.name}`, url);
      nameToUrlMap.set(`/${asset.name}`, url);
    }
  }

  // Replace markdown image syntax: ![alt](url)
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSrc) => {
    const src = rawSrc.trim();
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
      return match;
    }

    // Try exact match or basename match
    const filename = src.split('/').pop()?.split('#')[0].split('?')[0] || '';
    const targetUrl =
      nameToUrlMap.get(src) ||
      nameToUrlMap.get(src.toLowerCase()) ||
      nameToUrlMap.get(filename) ||
      nameToUrlMap.get(filename.toLowerCase());

    if (targetUrl) {
      return `![${alt}](${targetUrl})`;
    }

    return match;
  });
};

/**
 * Fetch a public share snapshot from GET /s/:token without sending authenticated credentials.
 */
export const fetchPublicShare = async (
  token: string,
  options: { baseUrl?: string; fetchFn?: typeof fetch } = {}
): Promise<PublicShare> => {
  const fetchImpl = options.fetchFn || fetch;
  const baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
  const url = `${baseUrl}/s/${encodeURIComponent(token)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit', // Critical: Never send session cookies for public share fetching
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new PublicShareError('FETCH_FAILED', 0, (err as Error)?.message || 'Network request failed');
  }

  if (response.status === 404) {
    throw new PublicShareError('NOT_FOUND', 404, 'Share not found or has been revoked');
  }

  if (response.status === 410) {
    throw new PublicShareError('EXPIRED', 410, 'Share has expired');
  }

  if (!response.ok) {
    throw new PublicShareError('FETCH_FAILED', response.status, `HTTP error ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new PublicShareError('INVALID_PAYLOAD', response.status, 'Invalid JSON payload received');
  }

  if (!data || typeof data !== 'object') {
    throw new PublicShareError('INVALID_PAYLOAD', 200, 'Invalid share response structure');
  }

  const payload = data as Partial<PublicShare>;
  if (typeof payload.markdown !== 'string' || typeof payload.id !== 'string') {
    throw new PublicShareError('INVALID_PAYLOAD', 200, 'Missing required markdown content');
  }

  return {
    id: payload.id,
    title: typeof payload.title === 'string' ? payload.title : 'Shared Document',
    markdown: payload.markdown,
    assets: Array.isArray(payload.assets) ? payload.assets : [],
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : '',
  };
};
