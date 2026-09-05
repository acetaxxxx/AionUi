import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { mockUsers, resetMockUsers, mockSqliteDatabase } = vi.hoisted(() => {
  type MockUser = { id: string; username: string; passwordHash: string };
  const users = new Map<string, MockUser>();

  const reset = (): void => {
    users.clear();
    users.set('system_default_user', {
      id: 'system_default_user',
      username: 'legacy-owner',
      passwordHash: 'existing-hash',
    });
  };

  class MockSqliteDatabase {
    prepare(sql: string) {
      return {
        get: (...params: unknown[]): { id: string; username?: string } | undefined => {
          if (sql.includes('WHERE username = ?')) {
            const username = params[0];
            const match = [...users.values()].find((user) => user.username === username);
            return match ? { id: match.id } : undefined;
          }
          const id = params[0];
          const username = params[1];
          const match = [...users.values()].find((user) => user.id === id || user.username === username);
          return match ? { id: match.id, username: match.username } : undefined;
        },
        run: (...params: unknown[]): void => {
          if (sql.startsWith('UPDATE users SET username')) {
            const [username, passwordHash, _updatedAt, id] = params;
            const user = users.get(String(id));
            if (user) {
              user.username = String(username);
              user.passwordHash = String(passwordHash);
            }
            return;
          }
          const [id, username, passwordHash] = params;
          users.set(String(id), { id: String(id), username: String(username), passwordHash: String(passwordHash) });
        },
      };
    }

    close(): void {}
  }

  reset();
  return { mockUsers: users, resetMockUsers: reset, mockSqliteDatabase: MockSqliteDatabase };
});

vi.mock('better-sqlite3', () => ({ default: mockSqliteDatabase }));

import { ensureUsers, parseUsersEnv } from '../../../packages/web-cli/src/ensureUsers';

describe('ensureUsers', () => {
  it('parses email-to-username mappings consistently with Web-Host SSO', () => {
    expect(parseUsersEnv('user@example.com:husband:secret,wife:other-secret')).toEqual([
      { username: 'husband', password: 'secret', email: 'user@example.com' },
      { username: 'wife', password: 'other-secret', email: undefined },
    ]);
  });

  it('migrates the legacy primary identity without changing its user id', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'aionui-ensure-users-'));
    const dbPath = path.join(dataDir, 'aionui-backend.db');
    resetMockUsers();
    writeFileSync(dbPath, 'mock database');

    try {
      await ensureUsers(
        { dataDir, usersEnv: 'new-owner:new-password', backendPort: 0 },
        { fetch, log: () => undefined, warn: () => undefined }
      );

      const users = [...mockUsers.values()].map(({ id, username }) => ({ id, username }));
      expect(users).toContainEqual({ id: 'system_default_user', username: 'new-owner' });
      expect(users).toHaveLength(1);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
