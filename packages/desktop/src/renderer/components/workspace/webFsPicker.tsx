/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side file/directory picker for WebUI.
 *
 * The native `dialog.showOpen` channel only exists inside Electron. In WebUI the
 * agent runs on the *server*, so a browser `<input type="file">` would pick the
 * wrong machine's files — the user must browse the server filesystem instead.
 * This module talks to `/api/fs/dir` (already exposed by the backend) and
 * resolves with absolute server paths, matching the native dialog's contract.
 */

import { ipcBridge } from '@/common';
import type { ShowOpenHandler, ShowOpenOptions } from '@/common/adapter/ipcBridge';
import { Button, Input, Modal, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import type { PickerEntry as Entry } from './webFsPickerUtils';
import {
  classifyFsError,
  matchesFilters,
  normalizeEntry,
  parentOf,
  resolveConfirmPath,
  resolveNewFolderPath,
  sortEntries,
} from './webFsPickerUtils';

const LAST_DIR_KEY = 'aionui:web-fs-picker:last-dir';

type PickerProps = {
  options: ShowOpenOptions;
  onDone: (paths: string[] | undefined) => void;
};

export const WebFsPicker: React.FC<PickerProps> = ({ options, onDone }) => {
  const { t } = useTranslation();
  const properties = options?.properties ?? [];
  const wantsDirectory = properties.includes('openDirectory');
  const wantsFile = properties.includes('openFile');
  const allowMultiple = properties.includes('multiSelections');
  const canCreateDirectory = properties.includes('createDirectory') || wantsDirectory;
  // `openFile` + `openDirectory` together (skills import) — treat as file-first
  // but still let a directory be chosen via the confirm button.
  const fileMode = wantsFile;

  const [visible, setVisible] = useState(true);
  const [currentDir, setCurrentDir] = useState<string>('');
  const [pathDraft, setPathDraft] = useState<string>('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const settledRef = useRef(false);

  const settle = useCallback(
    (paths: string[] | undefined) => {
      if (settledRef.current) return;
      settledRef.current = true;
      setVisible(false);
      // let the close animation finish before unmounting
      setTimeout(() => onDone(paths), 200);
    },
    [onDone]
  );

  const load = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError('');
      try {
        const raw = (await ipcBridge.fs.getFilesByDir.invoke({ dir, root: dir })) as unknown;
        const list = Array.isArray(raw) ? raw.map(normalizeEntry).filter((e): e is Entry => e !== null) : [];
        setEntries(sortEntries(list));
        setCurrentDir(dir);
        setPathDraft(dir);
        setSelected([]);
        try {
          localStorage.setItem(LAST_DIR_KEY, dir);
        } catch {
          /* storage unavailable — non-fatal */
        }
      } catch (err: unknown) {
        const errorKind = classifyFsError(err);
        if (errorKind === 'forbidden') {
          setError(
            t('fileSelection.webFsPicker.forbidden', {
              defaultValue: 'Access denied: path is outside allowed sandbox',
            })
          );
        } else if (errorKind === 'notFound') {
          setError(
            t('fileSelection.webFsPicker.notFound', {
              defaultValue: 'Directory not found',
            })
          );
        } else {
          setError(
            t('fileSelection.webFsPicker.loadFailed', {
              defaultValue: 'Cannot open this directory',
            })
          );
        }
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  // Resolve the starting directory: explicit defaultPath, then the last visited
  // directory, then the backend work dir, and finally the filesystem root.
  useEffect(() => {
    let cancelled = false;
    const resolveStart = async (): Promise<string> => {
      if (options?.defaultPath) return options.defaultPath;
      try {
        const last = localStorage.getItem(LAST_DIR_KEY);
        if (last) return last;
      } catch {
        /* ignore */
      }
      try {
        const info = await ipcBridge.application.systemInfo.invoke();
        if (info?.workDir) return info.workDir;
      } catch {
        /* ignore */
      }
      return '/';
    };
    void resolveStart().then((dir) => {
      if (!cancelled) void load(dir);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleEntries = useMemo(() => {
    if (!fileMode) return entries.filter((e) => e.isDir);
    return entries.filter((e) => e.isDir || matchesFilters(e.name, options?.filters));
  }, [entries, fileMode, options?.filters]);

  const toggleSelect = useCallback(
    (entry: Entry) => {
      if (entry.isDir) return;
      setSelected((prev) => {
        if (prev.includes(entry.fullPath)) return prev.filter((p) => p !== entry.fullPath);
        return allowMultiple ? [...prev, entry.fullPath] : [entry.fullPath];
      });
    },
    [allowMultiple]
  );

  const targetCandidate = resolveConfirmPath(pathDraft, currentDir, wantsDirectory);
  const confirmDisabled = fileMode ? selected.length === 0 && (!wantsDirectory || !targetCandidate) : !targetCandidate;

  const handleConfirm = useCallback(() => {
    if (fileMode && selected.length > 0) {
      settle(selected);
      return;
    }
    const resolved = resolveConfirmPath(pathDraft, currentDir, wantsDirectory);
    if (resolved) settle([resolved]);
  }, [fileMode, selected, pathDraft, currentDir, wantsDirectory, settle]);

  const handleCreateFolder = useCallback(() => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const parent = currentDir || pathDraft.trim() || '/';
    const resolvedPath = resolveNewFolderPath(parent, trimmed);
    setPathDraft(resolvedPath);
    setShowNewFolder(false);
    setNewFolderName('');
    void load(resolvedPath);
  }, [newFolderName, currentDir, pathDraft, load]);

  const title = wantsDirectory
    ? t('fileSelection.webFsPicker.titleDirectory', { defaultValue: 'Select a folder on the server' })
    : t('fileSelection.webFsPicker.titleFile', { defaultValue: 'Select a file on the server' });

  return (
    <Modal
      visible={visible}
      title={title}
      onCancel={() => settle(undefined)}
      autoFocus={false}
      focusLock
      wrapStyle={{ zIndex: 10500 }}
      maskStyle={{ zIndex: 10499 }}
      style={{ width: 'calc(100vw - 32px)', maxWidth: 640 }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span
            style={{ fontSize: 12, color: 'var(--color-text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={
              fileMode && selected.length > 0
                ? selected.join('\n')
                : resolveConfirmPath(pathDraft, currentDir, wantsDirectory)
            }
          >
            {fileMode && selected.length > 0
              ? t('fileSelection.webFsPicker.selectedCount', {
                  defaultValue: '{{count}} selected',
                  count: selected.length,
                })
              : resolveConfirmPath(pathDraft, currentDir, wantsDirectory)}
          </span>
          <span style={{ flexShrink: 0 }}>
            <Button onClick={() => settle(undefined)} style={{ marginInlineEnd: 8 }}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type='primary' disabled={confirmDisabled} onClick={handleConfirm}>
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </span>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button onClick={() => void load(parentOf(currentDir))} disabled={loading || currentDir === '/'}>
          {t('fileSelection.webFsPicker.up', { defaultValue: 'Up' })}
        </Button>
        <Input
          value={pathDraft}
          onChange={setPathDraft}
          onPressEnter={() => void load(pathDraft.trim() || '/')}
          placeholder='/path/to/folder'
        />
        <Button onClick={() => void load(pathDraft.trim() || '/')} disabled={loading}>
          {t('fileSelection.webFsPicker.go', { defaultValue: 'Go' })}
        </Button>
        <Button
          onClick={() => void load(currentDir || pathDraft.trim() || '/')}
          disabled={loading}
          title={t('common.refresh', { defaultValue: 'Refresh' })}
        >
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
        {canCreateDirectory && (
          <Button
            onClick={() => setShowNewFolder((prev) => !prev)}
            disabled={loading}
            title={t('common.newFolder', { defaultValue: 'New Folder' })}
          >
            {t('common.newFolder', { defaultValue: 'New Folder' })}
          </Button>
        )}
      </div>

      {showNewFolder && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <Input
            value={newFolderName}
            onChange={setNewFolderName}
            onPressEnter={handleCreateFolder}
            placeholder={t('fileSelection.webFsPicker.newFolderPlaceholder', { defaultValue: 'Folder name' })}
            autoFocus
          />
          <Button type='primary' onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
            {t('common.confirm', { defaultValue: 'OK' })}
          </Button>
          <Button
            onClick={() => {
              setShowNewFolder(false);
              setNewFolderName('');
            }}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
        </div>
      )}

      <div
        style={{
          height: 320,
          overflowY: 'auto',
          border: '1px solid var(--color-border-2)',
          borderRadius: 4,
          padding: 4,
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
            <Spin />
          </div>
        ) : error ? (
          <div style={{ padding: 16 }}>
            <div style={{ color: 'var(--color-danger-6)', marginBottom: 12 }}>{error}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {currentDir && currentDir !== '/' && (
                <Button size='small' onClick={() => void load(parentOf(currentDir))}>
                  {t('fileSelection.webFsPicker.up', { defaultValue: 'Up' })}
                </Button>
              )}
              <Button size='small' onClick={() => void load(currentDir || pathDraft.trim() || '/')}>
                {t('common.refresh', { defaultValue: 'Refresh' })}
              </Button>
              {wantsDirectory && pathDraft.trim() && (
                <Button size='small' type='primary' onClick={handleConfirm}>
                  {t('fileSelection.webFsPicker.selectTypedPath', { defaultValue: 'Select this path' })}
                </Button>
              )}
            </div>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--color-text-3)' }}>
            {t('fileSelection.webFsPicker.empty', { defaultValue: 'Nothing here' })}
          </div>
        ) : (
          visibleEntries.map((entry) => {
            const isSelected = selected.includes(entry.fullPath);
            return (
              <div
                key={entry.fullPath}
                onClick={() => (entry.isDir ? void load(entry.fullPath) : toggleSelect(entry))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: isSelected ? 'var(--color-fill-2)' : 'transparent',
                }}
              >
                <span style={{ flexShrink: 0 }}>{entry.isDir ? '📁' : '📄'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
};

/**
 * Imperative entry point: mounts the picker on a detached node so it works from
 * plain callbacks (the native dialog it replaces was callable the same way).
 */
export const showWebFsPicker: ShowOpenHandler = (options) =>
  new Promise<string[] | undefined>((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (paths: string[] | undefined) => {
      root.unmount();
      host.remove();
      resolve(paths);
    };
    root.render(<WebFsPicker options={options} onDone={done} />);
  });

export default showWebFsPicker;
