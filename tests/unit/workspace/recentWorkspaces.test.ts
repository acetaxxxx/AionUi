/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECENT_WS_KEY,
  addRecentWorkspace,
  getRecentWorkspaces,
} from '@/renderer/components/workspace/recentWorkspaces';

const TEST_KEY = 'test:recent-workspaces';

const createMockStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe('recentWorkspaces', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = createMockStorage();
  });

  it('returns empty array when no workspaces stored', () => {
    expect(getRecentWorkspaces(TEST_KEY)).toEqual([]);
  });

  it('adds workspace and retrieves it', () => {
    addRecentWorkspace('/data/project-a', TEST_KEY);
    expect(getRecentWorkspaces(TEST_KEY)).toEqual(['/data/project-a']);
  });

  it('deduplicates and moves latest to front', () => {
    addRecentWorkspace('/data/project-a', TEST_KEY);
    addRecentWorkspace('/data/project-b', TEST_KEY);
    addRecentWorkspace('/data/project-a', TEST_KEY);

    expect(getRecentWorkspaces(TEST_KEY)).toEqual(['/data/project-a', '/data/project-b']);
  });

  it('caps at maximum 5 recent workspaces', () => {
    for (let i = 1; i <= 7; i++) {
      addRecentWorkspace(`/data/project-${i}`, TEST_KEY);
    }

    const recents = getRecentWorkspaces(TEST_KEY);
    expect(recents.length).toBe(5);
    expect(recents[0]).toBe('/data/project-7');
    expect(recents[4]).toBe('/data/project-3');
  });

  it('falls back to default key when key is omitted', () => {
    addRecentWorkspace('/data/default-project');
    expect(getRecentWorkspaces()).toEqual(['/data/default-project']);
    expect(getRecentWorkspaces(DEFAULT_RECENT_WS_KEY)).toEqual(['/data/default-project']);
  });
});
