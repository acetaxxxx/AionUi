/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards ③ (permanent expand-state loss) — NARROWED by call site:
 *  - USER-driven collapse-all (setExpandedKeys([])) persists empty normally
 *    (legit: next open stays collapsed);
 *  - only openProject's leave-persist refuses to overwrite a populated record
 *    with a transiently-empty expanded (the switch-race source).
 *
 * Mutations:
 *  - drop the guard on openProject's leave-persist → the race test clobbers 2→0;
 *  - add the guard to the user path (setExpandedKeys) → the collapse-all test
 *    fails to persist empty (stays 2).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { peKey } from '@/renderer/pages/conversation/explorer/explorerModel';
import {
  collapseAll,
  getExplorerSnapshot,
  openProject,
  resetExplorerStoreForTest,
  setExpanded,
  setExpandedKeys,
} from '@/renderer/pages/conversation/explorer/explorerStore';

const lsKey = (id: string) => `explorer-ui:${id}`;
const readExpanded = (id: string): string[] => {
  const raw = localStorage.getItem(lsKey(id));
  return raw ? (JSON.parse(raw).expanded ?? []) : [];
};

beforeEach(() => {
  resetExplorerStoreForTest();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe('explorerStore persistUi anti-clobber — narrowed to openProject leave-persist (③)', () => {
  it('defaults roots to expanded only when no valid preference was saved', () => {
    openProject('first-run', [{ pe_id: 'peA', title: 'A' }]);

    expect(getExplorerSnapshot().expanded).toEqual([peKey('peA', '')]);

    resetExplorerStoreForTest();
    localStorage.setItem(lsKey('corrupt-preference'), '{invalid');
    openProject('corrupt-preference', [{ pe_id: 'peB', title: 'B' }]);
    expect(getExplorerSnapshot().expanded).toEqual([peKey('peB', '')]);
  });

  it('keeps Collapse All after the store reloads', () => {
    openProject('A', [{ pe_id: 'peA', title: 'A' }]);
    setExpanded(peKey('peA', 'sub'), true);
    collapseAll();
    expect(readExpanded('A')).toEqual([]);

    // Reset module state while preserving localStorage, as a renderer/store reload does.
    resetExplorerStoreForTest();
    openProject('A', [{ pe_id: 'peA', title: 'A' }]);

    expect(getExplorerSnapshot().expanded).toEqual([]);
  });

  it('USER collapse-all persists empty (legit — next open stays collapsed)', () => {
    openProject('A', [{ pe_id: 'peA', title: 'A' }]);
    setExpanded(peKey('peA', ''), true);
    setExpanded(peKey('peA', 'sub'), true);
    expect(readExpanded('A').length).toBe(2);

    // User collapses everything via the controlled tree — a real onExpand([]).
    setExpandedKeys([]);

    // Legit: the empty state IS persisted (not guarded on the user path).
    expect(readExpanded('A')).toEqual([]);
  });

  it('openProject leave-persist does NOT overwrite a populated record with a race-empty set', () => {
    // Populated persisted state for A, but in-memory expanded transiently empty
    // while projectId is still A (the switch-race shape).
    openProject('A', [{ pe_id: 'peA', title: 'A' }]);
    setExpandedKeys([]); // empties in-memory + writes empty (user path)
    // Re-seed A's stored record as populated (as if it held real expansion).
    localStorage.setItem(lsKey('A'), JSON.stringify({ expanded: [peKey('peA', ''), peKey('peA', 'sub')] }));

    // Switch to B → openProject leave-persists A with the empty in-memory set.
    openProject('B', [{ pe_id: 'peB', title: 'B' }]);

    // Guard holds: A's populated record survives (not clobbered to []).
    expect(readExpanded('A').length).toBe(2);
  });

  it('still persists a normal non-empty → non-empty change (no over-guarding)', () => {
    openProject('A', [{ pe_id: 'peA', title: 'A' }]);
    setExpanded(peKey('peA', ''), true);
    setExpanded(peKey('peA', 'sub'), true);
    expect(readExpanded('A').length).toBe(2);

    setExpandedKeys([peKey('peA', '')]);
    expect(readExpanded('A')).toEqual([peKey('peA', '')]);
  });
});
