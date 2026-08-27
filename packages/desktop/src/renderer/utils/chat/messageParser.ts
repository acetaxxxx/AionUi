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

type FilePathOptions = {
  allowAbsolute?: boolean;
};

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const MARKDOWN_ATTACHMENT_LINE_PATTERN = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~|\|)/;

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

const isValidAbsoluteLocalPath = (filePath: string): boolean => {
  const trimmed = filePath.trim();
  const isAbsolute = trimmed.startsWith('/') || trimmed.startsWith('\\\\') || WINDOWS_DRIVE_PATTERN.test(trimmed);
  if (!isAbsolute || trimmed.includes('\0') || trimmed.toLowerCase().includes('%00')) return false;

  const decoded = safeDecodePath(trimmed);
  if (decoded.includes('\0')) return false;

  const segments = decoded.replace(/\\/g, '/').split('/');
  return !segments.some((segment) => segment === '..');
};

const isValidMessageFilePath = (filePath: string, options?: FilePathOptions): boolean =>
  isValidWorkspaceRelativePath(filePath) || (options?.allowAbsolute === true && isValidAbsoluteLocalPath(filePath));

/**
 * Validates a user-provided client file reference. Workspace-relative paths are
 * accepted by default; trusted desktop message paths may opt into absolute paths.
 */
export const validateUserFileReference = (item: unknown, options?: FilePathOptions): string | null => {
  if (!item) return null;
  if (typeof item === 'string') {
    return isValidMessageFilePath(item, options) ? item.trim() : null;
  }
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    if (typeof obj.path === 'string' && isValidMessageFilePath(obj.path, options)) {
      return obj.path.trim();
    }
    if (typeof obj.relative_path === 'string' && isValidMessageFilePath(obj.relative_path, options)) {
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
 * Parses an in-message file marker only when every trailing line is a valid
 * path. Invalid blocks remain ordinary text so message content is never lost.
 */
export const parseFileMarker = (
  content: string,
  canParseFileMarker: boolean,
  options?: FilePathOptions
): ParsedFileMarker => {
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
  const files = rawLines.map((line) => line.trim()).filter(Boolean);

  // A marker is structural only when every trailing line is a valid file path.
  // Otherwise it is ordinary message text and must be preserved verbatim.
  if (
    !files.length ||
    files.some(
      (filePath) => MARKDOWN_ATTACHMENT_LINE_PATTERN.test(filePath) || !isValidMessageFilePath(filePath, options)
    )
  ) {
    return { text: content, files: [] };
  }

  return {
    text: lines.slice(0, markerLineIndex).join('\n').trimEnd(),
    files,
  };
};

/**
 * Resolves a validated relative path within the conversation workspace. Trusted
 * desktop message paths can opt into already-absolute local paths.
 */
export const resolveMessageFilePath = (
  file_path: string,
  workspace?: string,
  options?: FilePathOptions
): string | null => {
  if (!file_path || !isValidMessageFilePath(file_path, options)) {
    return null;
  }

  if (options?.allowAbsolute === true && isValidAbsoluteLocalPath(file_path)) {
    return file_path.trim();
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
      const validated = validateUserFileReference(item, { allowAbsolute: true });
      if (validated && !list.includes(validated)) {
        list.push(validated);
      }
    }
  }

  if (contentObj && Array.isArray(contentObj.attachments)) {
    for (const item of contentObj.attachments) {
      const validated = validateUserFileReference(item, { allowAbsolute: true });
      if (validated && !list.includes(validated)) {
        list.push(validated);
      }
    }
  }

  for (const pf of parsedFiles) {
    if (isValidMessageFilePath(pf, { allowAbsolute: true }) && !list.includes(pf)) {
      list.push(pf);
    }
  }

  return list;
};
