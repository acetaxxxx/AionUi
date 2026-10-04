/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import type { PreviewContentType } from '@/common/types/office/preview';
import { getFileTypeInfo } from '@/renderer/utils/file/fileType';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';

type Props = {
  teamId: string;
  workspace: string;
};

const UNSUPPORTED_TEAM_PREVIEWS = new Set<PreviewContentType>(['ppt', 'word', 'excel', 'unsupported']);

/** Read-only file browser for collaborators, rooted at the workspace authorized by Team membership. */
const TeamWorkspaceExplorer: React.FC<Props> = ({ teamId, workspace }) => {
  const { t } = useTranslation();
  const { openPreview, clearPreviewForScope } = usePreviewContext();
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, IDirOrFile[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState(false);
  const mountedRef = useRef(false);
  const requestGeneration = useRef(0);
  const previewGeneration = useRef(0);

  const clearAfterAuthorizationError = useCallback(() => {
    requestGeneration.current += 1;
    previewGeneration.current += 1;
    setEntriesByDirectory({});
    setExpandedDirectories(new Set());
    setLoadingDirectories(new Set());
    setError(true);
    clearPreviewForScope();
  }, [clearPreviewForScope]);

  useEffect(() => {
    mountedRef.current = true;
    const generation = requestGeneration.current;
    setEntriesByDirectory({});
    setExpandedDirectories(new Set());
    setLoadingDirectories(new Set([workspace]));
    setError(false);

    void ipcBridge.fs.getFilesByDir
      .invoke({ dir: workspace, root: workspace })
      .then((entries) => {
        if (!mountedRef.current || requestGeneration.current !== generation) return;
        setEntriesByDirectory({ [workspace]: entries });
      })
      .catch(() => {
        if (!mountedRef.current || requestGeneration.current !== generation) return;
        clearAfterAuthorizationError();
      })
      .finally(() => {
        if (mountedRef.current && requestGeneration.current === generation) {
          setLoadingDirectories((current) => {
            const next = new Set(current);
            next.delete(workspace);
            return next;
          });
        }
      });

    return () => {
      mountedRef.current = false;
      requestGeneration.current += 1;
      previewGeneration.current += 1;
    };
  }, [clearAfterAuthorizationError, teamId, workspace]);

  const toggleDirectory = useCallback(
    async (directory: IDirOrFile) => {
      if (expandedDirectories.has(directory.fullPath)) {
        setExpandedDirectories((current) => {
          const next = new Set(current);
          next.delete(directory.fullPath);
          return next;
        });
        return;
      }

      if (entriesByDirectory[directory.fullPath]) {
        setExpandedDirectories((current) => new Set(current).add(directory.fullPath));
        return;
      }

      const generation = requestGeneration.current;
      setLoadingDirectories((current) => new Set(current).add(directory.fullPath));
      try {
        const entries = await ipcBridge.fs.getFilesByDir.invoke({ dir: directory.fullPath, root: workspace });
        if (!mountedRef.current || requestGeneration.current !== generation) return;
        setEntriesByDirectory((current) => ({ ...current, [directory.fullPath]: entries }));
        setExpandedDirectories((current) => new Set(current).add(directory.fullPath));
      } catch {
        if (mountedRef.current && requestGeneration.current === generation) clearAfterAuthorizationError();
      } finally {
        if (mountedRef.current && requestGeneration.current === generation) {
          setLoadingDirectories((current) => {
            const next = new Set(current);
            next.delete(directory.fullPath);
            return next;
          });
        }
      }
    },
    [clearAfterAuthorizationError, entriesByDirectory, expandedDirectories, workspace]
  );

  const openFile = useCallback(
    async (entry: IDirOrFile) => {
      const { contentType, language } = getFileTypeInfo(entry.name);
      if (UNSUPPORTED_TEAM_PREVIEWS.has(contentType)) return;
      const openGeneration = ++previewGeneration.current;
      const accessGeneration = requestGeneration.current;
      const fileRef = { kind: 'local' as const, path: entry.fullPath };
      try {
        const content = await ipcBridge.fs.readTeamWorkspaceContent.invoke({
          file: fileRef,
          encoding: contentType === 'image' || contentType === 'pdf' ? 'dataurl' : 'utf8',
        });
        if (
          !mountedRef.current ||
          requestGeneration.current !== accessGeneration ||
          previewGeneration.current !== openGeneration
        ) {
          return;
        }
        openPreview(content, contentType, {
          title: entry.name,
          file_name: entry.name,
          language,
          editable: false,
        });
      } catch {
        if (
          mountedRef.current &&
          requestGeneration.current === accessGeneration &&
          previewGeneration.current === openGeneration
        ) {
          clearAfterAuthorizationError();
        }
      }
    },
    [clearAfterAuthorizationError, openPreview]
  );

  const renderDirectory = (directory: string, depth = 0): React.ReactNode => {
    const entries = entriesByDirectory[directory] ?? [];
    if (entries.length === 0) {
      return <div className='px-12px py-8px text-12px text-t-secondary'>{t('conversation.workspace.empty')}</div>;
    }

    return (
      <ul className='m-0 list-none p-0' role={depth === 0 ? 'tree' : 'group'}>
        {entries.map((entry) => {
          const canPreview = entry.isDir || !UNSUPPORTED_TEAM_PREVIEWS.has(getFileTypeInfo(entry.name).contentType);
          return (
            <li
              key={entry.fullPath}
              role='treeitem'
              aria-expanded={entry.isDir ? expandedDirectories.has(entry.fullPath) : undefined}
            >
              {entry.isDir ? (
                <>
                  <button
                    type='button'
                    aria-label={entry.name}
                    aria-expanded={expandedDirectories.has(entry.fullPath)}
                    className='w-full truncate bg-transparent border-0 px-12px py-6px text-left text-13px text-t-primary hover:bg-2'
                    style={{ paddingInlineStart: `${12 + depth * 12}px` }}
                    onClick={() => void toggleDirectory(entry)}
                  >
                    {loadingDirectories.has(entry.fullPath) ? t('common.loading') : `▸ ${entry.name}`}
                  </button>
                  {expandedDirectories.has(entry.fullPath) && renderDirectory(entry.fullPath, depth + 1)}
                </>
              ) : (
                <button
                  type='button'
                  aria-label={entry.name}
                  disabled={!canPreview}
                  className='w-full truncate bg-transparent border-0 px-12px py-6px text-left text-13px text-t-primary hover:bg-2'
                  style={{ paddingInlineStart: `${12 + depth * 12}px` }}
                  onClick={() => void openFile(entry)}
                >
                  {entry.name}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className='h-full min-h-0 overflow-auto' data-testid='team-workspace-explorer' data-team-id={teamId}>
      {error ? (
        <div className='px-12px py-8px text-12px text-danger' role='alert'>
          {t('conversation.workspace.contextMenu.previewFailed')}
        </div>
      ) : loadingDirectories.has(workspace) ? (
        <div className='px-12px py-8px text-12px text-t-secondary'>{t('common.loading')}</div>
      ) : (
        renderDirectory(workspace)
      )}
    </div>
  );
};

export default TeamWorkspaceExplorer;
