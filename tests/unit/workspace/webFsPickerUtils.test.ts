/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  classifyFsError,
  matchesFilters,
  normalizeEntry,
  parentOf,
  resolveConfirmPath,
  resolveNewFolderPath,
  sortEntries,
} from '@/renderer/components/workspace/webFsPickerUtils';

describe('normalizeEntry', () => {
  it('accepts the snake_case shape the backend actually returns', () => {
    expect(normalizeEntry({ name: 'app', full_path: '/data/app', is_dir: true, is_file: false })).toEqual({
      name: 'app',
      fullPath: '/data/app',
      isDir: true,
    });
  });

  it('accepts the camelCase shape declared by IDirOrFile', () => {
    expect(normalizeEntry({ name: 'notes.md', fullPath: '/data/notes.md', isDir: false })).toEqual({
      name: 'notes.md',
      fullPath: '/data/notes.md',
      isDir: false,
    });
  });

  it('prefers camelCase when both spellings are present', () => {
    expect(
      normalizeEntry({ name: 'app', fullPath: '/camel', full_path: '/snake', isDir: true, is_dir: false })
    ).toEqual({ name: 'app', fullPath: '/camel', isDir: true });
  });

  it('treats a missing directory flag as a file', () => {
    expect(normalizeEntry({ name: 'x', full_path: '/x' })?.isDir).toBe(false);
  });

  it.each([
    ['null', null],
    ['a primitive', 'nope'],
    ['a row without a path', { name: 'x' }],
    ['a row without a name', { full_path: '/x' }],
    ['a row with an empty path', { name: 'x', full_path: '' }],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeEntry(raw)).toBeNull();
  });
});

describe('sortEntries', () => {
  it('lists directories before files and sorts each group by name', () => {
    const sorted = sortEntries([
      { name: 'readme.md', fullPath: '/readme.md', isDir: false },
      { name: 'src', fullPath: '/src', isDir: true },
      { name: 'app', fullPath: '/app', isDir: true },
      { name: 'LICENSE', fullPath: '/LICENSE', isDir: false },
    ]);

    expect(sorted.map((e) => e.name)).toEqual(['app', 'src', 'LICENSE', 'readme.md']);
  });

  it('does not mutate its input', () => {
    const input = [
      { name: 'b', fullPath: '/b', isDir: false },
      { name: 'a', fullPath: '/a', isDir: true },
    ];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('parentOf', () => {
  it.each([
    ['/data/easy-my', '/data'],
    ['/data', '/'],
    ['/', '/'],
    ['', '/'],
    ['/data/easy-my/', '/data'],
    ['/data/easy-my///', '/data'],
  ])('maps %s to %s', (input, expected) => {
    expect(parentOf(input)).toBe(expected);
  });

  it('never walks above the filesystem root', () => {
    let dir = '/a/b/c';
    for (let i = 0; i < 10; i++) dir = parentOf(dir);
    expect(dir).toBe('/');
  });
});

describe('matchesFilters', () => {
  it('accepts everything when no filter is supplied', () => {
    expect(matchesFilters('anything.bin', undefined)).toBe(true);
    expect(matchesFilters('anything.bin', [])).toBe(true);
  });

  it('matches on extension case-insensitively', () => {
    const filters = [{ name: 'Images', extensions: ['png', 'jpg'] }];
    expect(matchesFilters('logo.png', filters)).toBe(true);
    expect(matchesFilters('LOGO.PNG', filters)).toBe(true);
    expect(matchesFilters('notes.md', filters)).toBe(false);
  });

  it('treats a wildcard filter as "show everything"', () => {
    expect(matchesFilters('notes.md', [{ name: 'All', extensions: ['*'] }])).toBe(true);
  });

  it('does not hide every candidate when a filter carries no usable extension', () => {
    expect(matchesFilters('notes.md', [{ name: 'Broken', extensions: [] }])).toBe(true);
  });

  it('combines extensions across multiple filter groups', () => {
    const filters = [
      { name: 'Archives', extensions: ['zip'] },
      { name: 'Docs', extensions: ['md'] },
    ];
    expect(matchesFilters('skill.zip', filters)).toBe(true);
    expect(matchesFilters('readme.md', filters)).toBe(true);
    expect(matchesFilters('image.png', filters)).toBe(false);
  });

  it('requires a dot separator so suffix lookalikes do not match', () => {
    expect(matchesFilters('notzip', [{ name: 'Archives', extensions: ['zip'] }])).toBe(false);
  });
});

describe('resolveNewFolderPath', () => {
  it('appends a clean folder name to a directory', () => {
    expect(resolveNewFolderPath('/data/projects', 'my-team')).toBe('/data/projects/my-team');
  });

  it('handles root parent directory', () => {
    expect(resolveNewFolderPath('/', 'workspace')).toBe('/workspace');
    expect(resolveNewFolderPath('', 'workspace')).toBe('/workspace');
  });

  it('strips redundant slashes from parent and child', () => {
    expect(resolveNewFolderPath('/data/workspaces///', '//team-a//')).toBe('/data/workspaces/team-a');
    expect(resolveNewFolderPath('/data/workspaces', '\\team-b\\')).toBe('/data/workspaces/team-b');
  });

  it('returns parentDir when folder name is empty or whitespace', () => {
    expect(resolveNewFolderPath('/data/projects', '')).toBe('/data/projects');
    expect(resolveNewFolderPath('/data/projects', '   ')).toBe('/data/projects');
  });
});

describe('resolveConfirmPath', () => {
  it('prefers trimmed pathDraft in directory mode', () => {
    expect(resolveConfirmPath('/data/new-team', '/data/default', true)).toBe('/data/new-team');
    expect(resolveConfirmPath('  /data/trimmed  ', '/data/default', true)).toBe('/data/trimmed');
  });

  it('falls back to currentDir in directory mode when pathDraft is empty', () => {
    expect(resolveConfirmPath('', '/data/default', true)).toBe('/data/default');
    expect(resolveConfirmPath('   ', '/data/default', true)).toBe('/data/default');
  });

  it('returns currentDir in file mode regardless of pathDraft', () => {
    expect(resolveConfirmPath('/data/draft', '/data/default', false)).toBe('/data/default');
  });
});

describe('classifyFsError', () => {
  it('classifies 403 status as forbidden', () => {
    expect(classifyFsError({ status: 403 })).toBe('forbidden');
    expect(classifyFsError({ statusCode: 403 })).toBe('forbidden');
    expect(classifyFsError({ response: { status: 403 } })).toBe('forbidden');
  });

  it('classifies 404 status as notFound', () => {
    expect(classifyFsError({ status: 404 })).toBe('notFound');
    expect(classifyFsError({ statusCode: 404 })).toBe('notFound');
  });

  it('classifies permission and sandbox codes/messages as forbidden', () => {
    expect(classifyFsError({ code: 'PATH_OUTSIDE_SANDBOX' })).toBe('forbidden');
    expect(classifyFsError({ code: 'EACCES' })).toBe('forbidden');
    expect(classifyFsError({ code: 'EPERM' })).toBe('forbidden');
    expect(classifyFsError(new Error('path is outside allowed sandbox'))).toBe('forbidden');
    expect(classifyFsError('Forbidden: sandbox restriction')).toBe('forbidden');
  });

  it('classifies not-found codes/messages as notFound', () => {
    expect(classifyFsError({ code: 'ENOENT' })).toBe('notFound');
    expect(classifyFsError({ code: 'DIR_NOT_FOUND' })).toBe('notFound');
    expect(classifyFsError(new Error('No such file or directory: /path/foo'))).toBe('notFound');
  });

  it('falls back to generic for unknown errors', () => {
    expect(classifyFsError({ status: 500 })).toBe('generic');
    expect(classifyFsError(new Error('Network timeout'))).toBe('generic');
    expect(classifyFsError(null)).toBe('generic');
  });
});
