/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

import { diffColors } from '@/renderer/styles/colors';

/** Preserve inline image data URLs rejected by ReactMarkdown's default transform. */
export const isImageDataUrl = (value: string): boolean => {
  return /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.-]+)*,/.test(value.trim().toLowerCase());
};

/**
 * Format raw code string, attempting JSON pretty-print.
 * Falls back to stripped trailing newline if parsing fails.
 */
export const formatCode = (code: string): string => {
  const content = String(code).replace(/\n$/, '');
  try {
    return JSON.stringify(
      JSON.parse(content),
      (_key, value) => {
        return value;
      },
      2
    );
  } catch (_error) {
    return content;
  }
};

/**
 * Conditional render helper — returns trueComponent when condition is true,
 * falseComponent otherwise.
 */
export const logicRender = <T, F>(condition: boolean, trueComponent: T, falseComponent?: F): T | F => {
  return condition ? trueComponent : (falseComponent as F);
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export type LocalFileLinkReference = {
  filePath: string;
  rawReference: string;
  line?: number;
  column?: number;
  endLine?: number;
};

type LocalFileLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  source?: 'hash' | 'colon';
};

type LocalFilePathCandidate = {
  filePath: string;
  hashLocation?: LocalFileLocation;
  hasInvalidHash?: boolean;
};

const parseHashLocation = (hash: string): LocalFileLocation | null => {
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!match) return null;

  const [, lineText, endLineText] = match;
  return {
    line: Number(lineText),
    endLine: endLineText == null ? undefined : Number(endLineText),
    source: 'hash',
  };
};

const splitHashLocation = (href: string): LocalFilePathCandidate => {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return { filePath: href };

  const hashLocation = parseHashLocation(href.slice(hashIndex));
  if (!hashLocation) {
    return {
      filePath: href.slice(0, hashIndex),
      hasInvalidHash: true,
    };
  }

  return {
    filePath: href.slice(0, hashIndex),
    hashLocation,
  };
};

const normalizeFilePath = (path: string): string => {
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
};

const hasPathTraversal = (filePath: string): boolean => {
  const decoded = safeDecodeURIComponent(filePath).replace(/\\/g, '/');
  return /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(decoded) || decoded.includes('/../') || decoded.includes('\\..\\');
};

const TRUSTED_INTERNAL_ROUTES = new Set([
  '/api/fs/content',
  '/api/fs/stream',
  '/preview',
]);

const isExactSameOrigin = (url: URL): boolean => {
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return url.origin === window.location.origin;
  }
  return false;
};

const extractFileFromHttpUrl = (url: URL): LocalFilePathCandidate | null => {
  // 1. Must be exact same origin (matching protocol, hostname, and port)
  if (!isExactSameOrigin(url)) return null;

  // 2. Must match an explicit trusted internal route
  const pathname = safeDecodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  if (!TRUSTED_INTERNAL_ROUTES.has(pathname)) {
    return null; // Reject non-trusted routes (e.g. /foo.html, /api/users, /settings, /chat)
  }

  // 3. Strictly trusted query keys: 'file' or 'path' (or 'relative_path' for stream)
  let queryFile = url.searchParams.get('file') || url.searchParams.get('path');
  if (!queryFile && pathname === '/api/fs/stream') {
    queryFile = url.searchParams.get('relative_path');
  }

  if (!queryFile) {
    return null; // Reject untrusted/missing queries
  }

  const decodedFile = safeDecodeURIComponent(queryFile).trim();
  if (!decodedFile || hasPathTraversal(decodedFile)) {
    return null; // Reject empty or directory traversal (../)
  }

  const rawHash = safeDecodeURIComponent(url.hash);
  const hashLocation = rawHash ? parseHashLocation(rawHash) : null;
  const pathCandidate = normalizeFilePath(decodedFile);

  return hashLocation
    ? { filePath: pathCandidate, hashLocation }
    : { filePath: pathCandidate, hasInvalidHash: Boolean(rawHash && !hashLocation) };
};

const normalizeLocalFileHrefToPath = (href: string): LocalFilePathCandidate | null => {
  if (hasPathTraversal(href)) {
    return null;
  }

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return extractFileFromHttpUrl(url);
    } catch {
      return null;
    }
  }

  if (href.startsWith('?') || href.startsWith('/preview?') || href.startsWith('/api/fs/')) {
    try {
      const baseOrigin =
        typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
          ? window.location.origin
          : 'http://localhost';
      const url = new URL(href, baseOrigin);
      const pathname = safeDecodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
      if (!TRUSTED_INTERNAL_ROUTES.has(pathname)) return null;

      let queryFile = url.searchParams.get('file') || url.searchParams.get('path');
      if (!queryFile && pathname === '/api/fs/stream') {
        queryFile = url.searchParams.get('relative_path');
      }
      if (!queryFile) return null;

      const decodedFile = safeDecodeURIComponent(queryFile).trim();
      if (!decodedFile || hasPathTraversal(decodedFile)) return null;

      const rawHash = safeDecodeURIComponent(url.hash);
      const hashLocation = rawHash ? parseHashLocation(rawHash) : null;
      const pathCandidate = normalizeFilePath(decodedFile);

      return hashLocation
        ? { filePath: pathCandidate, hashLocation }
        : { filePath: pathCandidate, hasInvalidHash: Boolean(rawHash && !hashLocation) };
    } catch {
      return null;
    }
  }

  if (/^aion-file:/i.test(href)) {
    try {
      const url = new URL(href);
      const rawPath = safeDecodeURIComponent(url.pathname || url.hostname + url.pathname);
      const path = normalizeFilePath(rawPath.replace(/^\/+/, '/'));
      if (hasPathTraversal(path)) return null;

      const rawHash = safeDecodeURIComponent(url.hash);
      if (!rawHash) return { filePath: path };

      const hashLocation = parseHashLocation(rawHash);
      return hashLocation ? { filePath: path, hashLocation } : { filePath: path, hasInvalidHash: true };
    } catch {
      const stripped = href.replace(/^aion-file:(?:\/\/)?/i, '');
      const candidate = splitHashLocation(stripped);
      if (hasPathTraversal(candidate.filePath)) return null;
      return {
        ...candidate,
        filePath: normalizeFilePath(candidate.filePath),
      };
    }
  }

  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href);
      const path = normalizeFilePath(safeDecodeURIComponent(url.pathname));
      if (hasPathTraversal(path)) return null;

      const rawHash = safeDecodeURIComponent(url.hash);
      if (!rawHash) return { filePath: path };

      const hashLocation = parseHashLocation(rawHash);
      return hashLocation ? { filePath: path, hashLocation } : { filePath: path, hasInvalidHash: true };
    } catch {
      const stripped = href.replace(/^file:(?:\/\/)?/i, '');
      const candidate = splitHashLocation(stripped);
      if (hasPathTraversal(candidate.filePath)) return null;
      return {
        ...candidate,
        filePath: normalizeFilePath(candidate.filePath),
      };
    }
  }

  const candidate = splitHashLocation(href);
  const path = candidate.filePath;
  if (hasPathTraversal(path)) return null;

  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return {
      ...candidate,
      filePath: path,
    };
  }

  if (/^\/[A-Za-z]:[\\/]/.test(path)) {
    return {
      ...candidate,
      filePath: path.slice(1),
    };
  }

  if (/^\/(Users|home|tmp|private|var|mnt|Volumes)\//.test(path)) return candidate;
  if (/^\/[^/?#]+\/.+\.[^/?#/.]+$/.test(path)) return candidate;

  return null;
};

const splitLocationSuffix = (filePath: string): Omit<LocalFileLinkReference, 'rawReference'> & LocalFileLocation => {
  const lineColumnMatch = /^(.*):(\d+):(\d+)$/.exec(filePath);
  if (lineColumnMatch) {
    const [, pathWithoutLocation, lineText, columnText] = lineColumnMatch;
    if (normalizeLocalFileHrefToPath(pathWithoutLocation)) {
      return {
        filePath: pathWithoutLocation,
        line: Number(lineText),
        column: Number(columnText),
        source: 'colon',
      };
    }
  }

  const lineMatch = /^(.*):(\d+)$/.exec(filePath);
  if (!lineMatch) return { filePath };

  const [, pathWithoutLocation, lineText] = lineMatch;
  if (!normalizeLocalFileHrefToPath(pathWithoutLocation)) return { filePath };

  return {
    filePath: pathWithoutLocation,
    line: Number(lineText),
    source: 'colon',
  };
};

const formatRawReference = (
  reference: Omit<LocalFileLinkReference, 'rawReference'>,
  source?: 'hash' | 'colon'
): string => {
  if (reference.line == null) return reference.filePath;

  if (source === 'hash') {
    return `${reference.filePath}#L${reference.line}${reference.endLine == null ? '' : `-L${reference.endLine}`}`;
  }

  return `${reference.filePath}:${reference.line}${reference.column == null ? '' : `:${reference.column}`}`;
};

export const resolveLocalFileLinkReference = (
  rawHref: string,
  resolvedHref?: string
): LocalFileLinkReference | null => {
  const href = safeDecodeURIComponent((rawHref || resolvedHref || '').trim());
  if (!href) return null;

  const candidate = normalizeLocalFileHrefToPath(href);
  if (!candidate || candidate.hasInvalidHash) return null;

  const colonReference = splitLocationSuffix(candidate.filePath);
  const reference =
    candidate.hashLocation?.line == null
      ? colonReference
      : {
          ...candidate.hashLocation,
          filePath: colonReference.filePath,
        };

  if (!reference.filePath) return null;

  const source = candidate.hashLocation?.line == null ? colonReference.source : 'hash';
  const { source: _source, ...publicReference } = reference;
  return {
    ...publicReference,
    rawReference: formatRawReference(publicReference, source),
  };
};

export const resolveLocalFileLinkPath = (rawHref: string, resolvedHref?: string): string | null => {
  return resolveLocalFileLinkReference(rawHref, resolvedHref)?.filePath ?? null;
};

export const toLocalFileHref = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const withScheme = /^[A-Za-z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}`;
  return encodeURI(withScheme);
};

/**
 * Get line background style for diff rendering.
 * Highlights additions (green), deletions (red), and hunk headers (blue).
 */
export const getDiffLineStyle = (line: string, isDark: boolean): React.CSSProperties => {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { backgroundColor: isDark ? diffColors.additionBgDark : diffColors.additionBgLight };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { backgroundColor: isDark ? diffColors.deletionBgDark : diffColors.deletionBgLight };
  }
  if (line.startsWith('@@')) {
    return { backgroundColor: isDark ? diffColors.hunkBgDark : diffColors.hunkBgLight };
  }
  return {};
};
