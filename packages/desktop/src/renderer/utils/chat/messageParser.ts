/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIONUI_FILES_MARKER } from '@/common/config/constants';

export type ParsedFileMarker = {
  text: string;
  files: string[];
};

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;

const safeDecodePath = (path: string): string => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/**
 * Validates that a string is a safe, non-traversing workspace-relative path.
 * Rejects:
 * - Absolute host paths (/etc/passwd, \Windows, C:\foo)
 * - file:// and other URL schemes
 * - Directory traversal (../, ..\, foo/../../bar, percent-encoded %2e%2e)
 * - Empty, whitespace-only, or null-byte paths (\0, %00)
 */
export const isValidWorkspaceRelativePath = (filePath: string): boolean => {
  if (typeof filePath !== 'string') return false;
  const trimmed = filePath.trim();
  if (!trimmed) return false;

  // Check raw string for null byte or percent-encoded null
  if (trimmed.includes('\0') || trimmed.includes('%00') || trimmed.toLowerCase().includes('%2500')) {
    return false;
  }

  const decoded = safeDecodePath(trimmed);
  if (decoded.includes('\0')) {
    return false;
  }

  // Reject absolute paths, UNC paths, and URL schemes (both raw and decoded)
  for (const candidate of [trimmed, decoded]) {
    if (
      candidate.startsWith('/') ||
      candidate.startsWith('\\') ||
      WINDOWS_DRIVE_PATTERN.test(candidate) ||
      URL_SCHEME_PATTERN.test(candidate)
    ) {
      return false;
    }
  }

  // Normalize path separators and check for path traversal segments
  const normalized = decoded.replace(/\\/g, '/');
  if (/(?:^|\/)\.\.(?:\/|$)/.test(normalized) || normalized.includes('/../')) {
    return false; // Traversal attempt rejected
  }

  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '%2e%2e' || segment === '%2E%2E') {
      return false;
    }
  }

  // Must have at least one valid path segment
  const validSegments = segments.filter((s) => s && s !== '.');
  return validSegments.length > 0;
};

/**
 * Validates whether a user-provided client file reference is a valid workspace-relative path.
 */
export const validateUserFileReference = (item: unknown): string | null => {
  if (!item) return null;
  if (typeof item === 'string') {
    return isValidWorkspaceRelativePath(item) ? item.trim() : null;
  }
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    if (typeof obj.path === 'string' && isValidWorkspaceRelativePath(obj.path)) {
      return obj.path.trim();
    }
    if (typeof obj.relative_path === 'string' && isValidWorkspaceRelativePath(obj.relative_path)) {
      return obj.relative_path.trim();
    }
  }
  return null;
};

const isFileMarkerLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === AIONUI_FILES_MARKER || trimmed === '__AIONUI_FILES__' || trimmed === '[[AIONUI_FILES]]';
};

/**
 * Parses in-message file marker and extracts only validated workspace-relative paths.
 * Rejects raw absolute host paths, URLs, and traversal paths.
 */
export const parseFileMarker = (content: string, canParseFileMarker: boolean): ParsedFileMarker => {
  if (!canParseFileMarker || typeof content !== 'string') {
    return { text: content || '', files: [] };
  }

  const lines = content.split(/\r?\n/);
  let markerLineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isFileMarkerLine(lines[index])) {
      markerLineIndex = index;
      break;
    }
  }

  if (markerLineIndex === -1) {
    return { text: content, files: [] };
  }

  const rawLines = lines.slice(markerLineIndex + 1);
  const files: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isValidWorkspaceRelativePath(trimmed)) {
      files.push(trimmed);
    }
  }

  return {
    text: lines.slice(0, markerLineIndex).join('\n').trimEnd(),
    files,
  };
};

/**
 * Resolves a validated workspace-relative path against the conversation workspace,
 * strictly guaranteeing that the resolved path is contained within the workspace root.
 * Returns null if the path is invalid, escapes containment, or workspace is missing.
 */
export const resolveMessageFilePath = (file_path: string, workspace?: string): string | null => {
  if (!file_path || !isValidWorkspaceRelativePath(file_path)) {
    return null;
  }

  if (!workspace || !workspace.trim()) {
    return null;
  }

  const normalizedWorkspace = workspace
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  const normalizedFilePath = file_path
    .trim()
    .replace(/^\.?[\\/]+/, '')
    .replace(/\\/g, '/');

  // Verify normalizedFilePath does not contain any traversal
  const segments = normalizedFilePath.split('/');
  if (segments.some((seg) => seg === '..')) {
    return null;
  }

  const resolved = `${normalizedWorkspace}/${normalizedFilePath}`.replace(/\/+/g, '/');

  // Strict containment verification: resolved path must start with normalizedWorkspace + '/'
  if (!resolved.startsWith(`${normalizedWorkspace}/`)) {
    return null;
  }

  return resolved;
};

/**
 * Extracts and strictly validates files from message content based on sender trust boundary:
 * - Assistant messages (isUserMessage: false / default):
 *   Rejects assistant files/attachments/markers from triggering file preview until explicit
 *   backend-issued provenance is introduced. Shape-only objects ({kind: 'project'}, {kind: 'local'}),
 *   untyped strings, and assistant markers are rejected.
 * - User messages (isUserMessage: true):
 *   Accepts validated client file uploads and user-typed file markers.
 */
export const extractMessageFiles = (
  contentObj: Record<string, unknown> | null | undefined,
  parsedFiles: string[] = [],
  options?: { isUserMessage?: boolean }
): string[] => {
  const isUser = options?.isUserMessage === true;

  if (!isUser) {
    // Assistant message: reject untrusted assistant files/attachments/markers for preview
    return [];
  }

  // User message: accept client file uploads and parsed user markers
  const list: string[] = [];

  if (contentObj && Array.isArray(contentObj.files)) {
    for (const item of contentObj.files) {
      const validated = validateUserFileReference(item);
      if (validated && !list.includes(validated)) {
        list.push(validated);
      }
    }
  }

  if (contentObj && Array.isArray(contentObj.attachments)) {
    for (const item of contentObj.attachments) {
      const validated = validateUserFileReference(item);
      if (validated && !list.includes(validated)) {
        list.push(validated);
      }
    }
  }

  for (const pf of parsedFiles) {
    if (isValidWorkspaceRelativePath(pf) && !list.includes(pf)) {
      list.push(pf);
    }
  }

  return list;
};
