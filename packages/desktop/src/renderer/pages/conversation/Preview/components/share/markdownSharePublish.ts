/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type PublishShareResult = {
  token: string;
  shareUrl: string;
  id: string;
  title: string;
  expiresAt: string;
};

export const DEFAULT_PUBLIC_SHARE_HOST = 'https://share.snoozydoggy.com';

/**
 * Resolve the public share host URL.
 */
export const getPublicShareHost = (): string => {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__AIONUI_PUBLIC_SHARE_HOST__) {
    return String((window as unknown as Record<string, unknown>).__AIONUI_PUBLIC_SHARE_HOST__).replace(/\/+$/, '');
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_SHARE_HOST) {
    return String(import.meta.env.VITE_PUBLIC_SHARE_HOST).replace(/\/+$/, '');
  }
  return DEFAULT_PUBLIC_SHARE_HOST;
};

/**
 * Sanitize Markdown for public sharing.
 * Preserves inline data:image and remote http(s) images.
 * Replaces local filesystem paths (file://, /Users/..., C:\...) to prevent leaking sensitive local paths.
 */
export const sanitizeMarkdownForShare = (markdown: string): string => {
  if (!markdown) return '';
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSrc) => {
    const src = rawSrc.trim();
    if (src.startsWith('data:image/') || /^https?:\/\//i.test(src)) {
      return match;
    }
    // Local filesystem path or file:// link -> sanitize src
    return `![${alt}](image)`;
  });
};

/**
 * Build public share URL from token.
 */
export const buildPublicShareUrl = (token: string, publicHost = getPublicShareHost()): string => {
  const host = publicHost.replace(/\/+$/, '');
  return `${host}/s/${encodeURIComponent(token)}`;
};

/**
 * Publish Markdown snapshot to POST /api/shares/markdown on the protected app host.
 */
export const publishMarkdownShare = async (
  markdown: string,
  title?: string,
  options: { fetchFn?: typeof fetch; appHostUrl?: string; publicHostUrl?: string } = {}
): Promise<PublishShareResult> => {
  const fetchImpl = options.fetchFn || fetch;
  const appHost = (options.appHostUrl || '').replace(/\/+$/, '');
  const url = `${appHost}/api/shares/markdown`;

  const sanitizedMarkdown = sanitizeMarkdownForShare(markdown);
  const cleanTitle = (title || 'Shared Document').trim().slice(0, 200);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      credentials: 'include', // Protected app host requires authenticated session
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        title: cleanTitle,
        markdown: sanitizedMarkdown,
      }),
    });
  } catch (err) {
    throw new Error((err as Error)?.message || 'Failed to publish share');
  }

  if (!response.ok) {
    throw new Error(`Failed to publish share: HTTP ${response.status}`);
  }

  let data: { token?: string; id?: string; title?: string; expiresAt?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error('Invalid JSON response from share server');
  }

  if (!data || !data.token) {
    throw new Error('Share server did not return a valid token');
  }

  const shareUrl = buildPublicShareUrl(data.token, options.publicHostUrl);

  return {
    token: data.token,
    shareUrl,
    id: data.id || '',
    title: data.title || cleanTitle,
    expiresAt: data.expiresAt || '',
  };
};
