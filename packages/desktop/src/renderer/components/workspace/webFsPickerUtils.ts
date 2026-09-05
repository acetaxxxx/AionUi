/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for the WebUI server-side file picker. Kept free of React/Arco
 * imports so they can be unit-tested without a DOM.
 */

import type { ShowOpenOptions } from '@/common/adapter/ipcBridge';

export type PickerEntry = {
  name: string;
  fullPath: string;
  isDir: boolean;
};

/**
 * `/api/fs/dir` answers in snake_case (`full_path`, `is_dir`) while the shared
 * `IDirOrFile` type declares camelCase and `httpPost` does no key conversion,
 * so accept either shape rather than trusting one of them.
 */
export const normalizeEntry = (raw: unknown): PickerEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const fullPath = (item.fullPath ?? item.full_path) as string | undefined;
  const name = item.name as string | undefined;
  if (!fullPath || !name) return null;
  const isDir = Boolean(item.isDir ?? item.is_dir);
  return { name, fullPath, isDir };
};

/** Directories first, then case-insensitive by name — mirrors native pickers. */
export const sortEntries = (entries: PickerEntry[]): PickerEntry[] =>
  entries.toSorted((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

/** POSIX parent directory, clamped at the filesystem root. */
export const parentOf = (dir: string): string => {
  if (!dir || dir === '/') return '/';
  const trimmed = dir.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx);
};

/**
 * Electron's `filters` are advisory; treat an empty/`*` extension list as
 * "show everything" so a filtered picker never hides all candidates.
 */
export const matchesFilters = (name: string, filters: NonNullable<ShowOpenOptions>['filters']): boolean => {
  if (!filters || filters.length === 0) return true;
  const exts = filters.flatMap((f) => f.extensions ?? []).filter((e) => e && e !== '*');
  if (exts.length === 0) return true;
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(`.${ext.toLowerCase()}`));
};

/**
 * Resolves a new child folder path under parentDir.
 * Normalizes leading/trailing slashes and handles filesystem root.
 */
export const resolveNewFolderPath = (parentDir: string, folderName: string): string => {
  const trimmedName = folderName.trim().replace(/^[\\/]+|[\\/]+$/g, '');
  if (!trimmedName) return parentDir || '/';
  const base = (parentDir || '/').trim().replace(/\/+$/, '');
  return base ? `${base}/${trimmedName}` : `/${trimmedName}`;
};

/**
 * Resolves which path should be confirmed upon OK.
 * In directory mode, a typed path in draft takes precedence over the currently listed directory.
 */
export const resolveConfirmPath = (pathDraft: string, currentDir: string, wantsDirectory: boolean): string => {
  const trimmedDraft = pathDraft.trim();
  if (wantsDirectory && trimmedDraft) {
    return trimmedDraft;
  }
  return currentDir;
};

export type FsErrorKind = 'forbidden' | 'notFound' | 'generic';

/**
 * Classifies a filesystem error into semantic categories for user feedback.
 */
export const classifyFsError = (err: unknown): FsErrorKind => {
  if (typeof err !== 'object' || err === null) {
    const str = String(err || '').toLowerCase();
    if (str.includes('403') || str.includes('sandbox') || str.includes('forbidden') || str.includes('permission')) {
      return 'forbidden';
    }
    if (str.includes('404') || str.includes('not found') || str.includes('not exist') || str.includes('enoent')) {
      return 'notFound';
    }
    return 'generic';
  }

  const errObj = err as {
    status?: number;
    statusCode?: number;
    code?: string | number;
    message?: string;
    response?: { status?: number };
  };

  const status = errObj.status ?? errObj.statusCode ?? errObj.response?.status;
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';

  const code = String(errObj.code || '').toUpperCase();
  if (code === 'EACCES' || code === 'EPERM' || code === 'PATH_OUTSIDE_SANDBOX') return 'forbidden';
  if (code === 'ENOENT' || code === 'FILE_NOT_FOUND' || code === 'DIR_NOT_FOUND') return 'notFound';

  const msg = String(errObj.message || '').toLowerCase();
  if (msg.includes('403') || msg.includes('sandbox') || msg.includes('forbidden') || msg.includes('permission')) {
    return 'forbidden';
  }
  if (
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('not exist') ||
    msg.includes('no such file') ||
    msg.includes('enoent')
  ) {
    return 'notFound';
  }

  return 'generic';
};
