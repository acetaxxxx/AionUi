/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ShareAssetInput = {
  name: string;
  mime: string;
  data: string; // base64 payload
};

export type PublishShareResult = {
  token: string;
  shareUrl: string;
  id: string;
  title: string;
  expiresAt: string;
};

export const DEFAULT_PUBLIC_SHARE_HOST = 'https://share.snoozydoggy.com';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/tiff',
]);

const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_ASSET_COUNT = 64;

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
 * Check whether a local image source is safe to read.
 * Rejects file:// URIs, directory traversal escaping root, and non-image extensions.
 */
export const isSafeLocalImagePath = (src: string, _baseDir?: string, _workspace?: string): boolean => {
  if (!src) return false;
  const cleaned = src.trim();

  // Reject remote URLs, inline data URLs, and file:// scheme URLs
  if (cleaned.startsWith('data:') || /^https?:\/\//i.test(cleaned) || /^file:\/\//i.test(cleaned)) {
    return false;
  }

  // Reject unsupported file extensions
  const ext = cleaned.split('#')[0].split('?')[0].split('.').pop()?.toLowerCase();
  if (!ext || !['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff'].includes(ext)) {
    return false;
  }

  // Check path traversal escaping root
  const normSrc = cleaned.replace(/\\/g, '/');
  if (normSrc.includes('..')) {
    const parts = normSrc.split('/');
    let depth = 0;
    for (const p of parts) {
      if (p === '..') depth--;
      else if (p && p !== '.') depth++;
      if (depth < 0) return false; // Attempted to escape root
    }
  }

  return true;
};

/**
 * Resolve local Markdown image assets and sanitize Markdown.
 * Resolves local image files, embeds them as base64 asset payloads, and rewrites image URLs to asset names.
 */
export const processMarkdownShareAssets = async (
  markdown: string,
  options: {
    filePath?: string;
    workspace?: string;
    resolveImageFn?: (path: string, workspace?: string) => Promise<string | null>;
  } = {}
): Promise<{ sanitizedMarkdown: string; assets: ShareAssetInput[] }> => {
  if (!markdown) return { sanitizedMarkdown: '', assets: [] };

  const normalizedFilePath = options.filePath ? options.filePath.replace(/\\/g, '/') : undefined;
  const baseDir = normalizedFilePath
    ? normalizedFilePath.slice(0, normalizedFilePath.lastIndexOf('/'))
    : undefined;

  const assets: ShareAssetInput[] = [];
  const assetNameMap = new Map<string, string>(); // src -> asset.name

  // Collect unique local image references
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  const imageSourcesToResolve: string[] = [];

  while ((match = imageRegex.exec(markdown)) !== null) {
    const rawSrc = match[2].trim();
    if (
      !rawSrc.startsWith('data:image/') &&
      !/^https?:\/\//i.test(rawSrc) &&
      isSafeLocalImagePath(rawSrc, baseDir, options.workspace)
    ) {
      if (!imageSourcesToResolve.includes(rawSrc)) {
        imageSourcesToResolve.push(rawSrc);
      }
    }
  }

  const resolveFn =
    options.resolveImageFn ||
    (async (p: string, ws?: string) => {
      if (typeof window !== 'undefined') {
        const { ipcBridge } = await import('@/common');
        return ipcBridge.fs.getImageBase64.invoke({ path: p, workspace: ws });
      }
      return null;
    });

  for (const src of imageSourcesToResolve) {
    if (assets.length >= MAX_ASSET_COUNT) break;

    const cleanedSrc = src.replace(/\\/g, '/');
    const absolutePath = cleanedSrc.startsWith('/') || /^[a-zA-Z]:/.test(cleanedSrc)
      ? cleanedSrc
      : baseDir
      ? `${baseDir}/${cleanedSrc}`
      : cleanedSrc;

    try {
      const dataUrl = await resolveFn(absolutePath, options.workspace);
      if (!dataUrl || !dataUrl.startsWith('data:')) continue;

      const [header, base64Data] = dataUrl.split(';base64,');
      if (!header || !base64Data) continue;

      const mime = header.replace(/^data:/, '').trim().toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mime)) continue;

      const byteSize = Math.floor((base64Data.length * 3) / 4);
      if (byteSize > MAX_ASSET_BYTES) continue;

      const rawFilename = cleanedSrc.split('/').pop()?.split('#')[0].split('?')[0] || `asset-${assets.length + 1}.png`;
      let assetName = rawFilename;
      let counter = 1;
      while (assets.some((a) => a.name === assetName)) {
        const parts = rawFilename.split('.');
        const ext = parts.pop();
        assetName = `${parts.join('.')}-${counter}.${ext}`;
        counter++;
      }

      assets.push({
        name: assetName,
        mime,
        data: base64Data,
      });

      assetNameMap.set(src, assetName);
    } catch {
      // Ignore individual resolution failures
    }
  }

  // Rewrite Markdown image references
  const sanitizedMarkdown = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (fullMatch, alt, rawSrc) => {
    const src = rawSrc.trim();
    if (src.startsWith('data:image/') || /^https?:\/\//i.test(src)) {
      return fullMatch;
    }
    const resolvedName = assetNameMap.get(src);
    if (resolvedName) {
      return `![${alt}](${resolvedName})`;
    }
    return `![${alt}](image)`;
  });

  return { sanitizedMarkdown, assets };
};

/**
 * Sanitize Markdown for public sharing without uploading local assets (fallback sync version).
 */
export const sanitizeMarkdownForShare = (markdown: string): string => {
  if (!markdown) return '';
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSrc) => {
    const src = rawSrc.trim();
    if (src.startsWith('data:image/') || /^https?:\/\//i.test(src)) {
      return match;
    }
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
 * Publish Markdown snapshot to POST /api/shares/markdown on the protected app host with resolved image assets.
 */
export const publishMarkdownShare = async (
  markdown: string,
  title?: string,
  options: {
    fetchFn?: typeof fetch;
    appHostUrl?: string;
    publicHostUrl?: string;
    filePath?: string;
    workspace?: string;
    resolveImageFn?: (path: string, workspace?: string) => Promise<string | null>;
  } = {}
): Promise<PublishShareResult> => {
  const fetchImpl = options.fetchFn || fetch;
  const appHost = (options.appHostUrl || '').replace(/\/+$/, '');
  const url = `${appHost}/api/shares/markdown`;

  const { sanitizedMarkdown, assets } = await processMarkdownShareAssets(markdown, {
    filePath: options.filePath,
    workspace: options.workspace,
    resolveImageFn: options.resolveImageFn,
  });

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
        assets: assets.length > 0 ? assets : undefined,
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
