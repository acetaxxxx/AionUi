/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Multi-user initialization module for AionUi WebUI.
 *
 * Reads AIONUI_USERS environment variable (e.g. `husband:password123,wife:password456`
 * or JSON `[{"username":"husband","password":"password123"},{"username":"wife","password":"password456"}]`).
 * Seeds and ensures these users exist directly in aioncore's SQLite DB on startup.
 */

import fs from 'node:fs';
import path from 'node:path';

export type UserSpec = {
  username: string;
  password: string;
};

export type EnsureUsersOptions = {
  backendPort: number;
  dataDir?: string;
  usersEnv?: string;
};

export type EnsureUsersDeps = {
  fetch: typeof fetch;
  log: (msg: string) => void;
  warn: (msg: string) => void;
};

type SqliteStatement = {
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};

type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement;
  close?: () => void;
};

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;

/**
 * Parse `AIONUI_USERS` string into structured user specifications.
 * Supports comma-separated `user:pass,user2:pass2`,
 * `email:username:password`, and JSON formats.
 */
export function parseUsersEnv(rawEnv?: string): UserSpec[] {
  if (!rawEnv || !rawEnv.trim()) return [];
  const trimmed = rawEnv.trim();

  // Try parsing JSON format
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as UserSpec[];
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (u) => u && typeof u.username === 'string' && typeof u.password === 'string' && u.username.length > 0
        );
      }
    } catch {
      // Fall through to CSV parsing
    }
  }

  // CSV format: user1:pass1,user2:pass2
  const specs: UserSpec[] = [];
  const entries = trimmed.split(',');
  for (const entry of entries) {
    const firstColonIdx = entry.indexOf(':');
    const secondColonIdx = entry.indexOf(':', firstColonIdx + 1);
    const isEmailMapping =
      firstColonIdx > 0 && secondColonIdx > firstColonIdx && entry.slice(0, firstColonIdx).includes('@');
    const usernameStart = isEmailMapping ? firstColonIdx + 1 : 0;
    const passwordStart = isEmailMapping ? secondColonIdx + 1 : firstColonIdx + 1;
    if (firstColonIdx > 0 && passwordStart > usernameStart) {
      const usernameEnd = isEmailMapping ? secondColonIdx : firstColonIdx;
      const username = entry.slice(usernameStart, usernameEnd).trim();
      const password = entry.slice(passwordStart).trim();
      if (username && password) {
        specs.push({ username, password });
      }
    }
  }
  return specs;
}

/**
 * Hash a plaintext password using bcrypt (cost 12) required by aioncore Rust backend.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof Bun !== 'undefined' && Bun.password && typeof Bun.password.hash === 'function') {
    try {
      return await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 });
    } catch {
      // Fallback
    }
  }
  try {
    const bcrypt = await import('bcryptjs');
    return bcrypt.hashSync(password, 12);
  } catch {
    throw new Error('Unable to hash AIONUI_USERS password with bcrypt');
  }
}

/**
 * Seed users from AIONUI_USERS environment variable into aioncore's SQLite database.
 */
export async function ensureUsers(opts: EnsureUsersOptions, deps: EnsureUsersDeps): Promise<void> {
  const envVal = opts.usersEnv ?? process.env.AIONUI_USERS;
  const specs = parseUsersEnv(envVal);

  if (specs.length === 0) {
    return;
  }

  const dataDir =
    opts.dataDir ??
    process.env.AIONUI_DATA_DIR ??
    path.join(process.env.HOME || '/root', process.env.NODE_ENV === 'production' ? '.aionui-web' : '.aionui-web-dev');
  const dbPath = path.join(dataDir, 'aionui-backend.db');

  deps.log(`[aionui-web] Ensuring ${specs.length} user(s) in SQLite database: ${dbPath}...`);

  let db: SqliteDatabase | undefined;
  try {
    let DatabaseClass: SqliteDatabaseConstructor | null = null;
    if (typeof Bun !== 'undefined') {
      const sqliteModule = await import('bun:sqlite');
      DatabaseClass = sqliteModule.Database as unknown as SqliteDatabaseConstructor;
    } else {
      const sqliteModule = await import('better-sqlite3');
      DatabaseClass = (sqliteModule.default || sqliteModule) as unknown as SqliteDatabaseConstructor;
    }

    if (!DatabaseClass || !fs.existsSync(dbPath)) {
      deps.warn(`[aionui-web] Database file not ready at ${dbPath}; skipping direct SQLite user seeding`);
      return;
    }

    db = new DatabaseClass(dbPath);
    const now = Date.now();

    const passwordHashes = await Promise.all(specs.map((spec) => hashPassword(spec.password)));
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const passwordHash = passwordHashes[i];

      // Check if user already exists
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(spec.username) as
        | { id?: string }
        | undefined;
      if (existing) {
        deps.log(`[aionui-web] User "${spec.username}" is ready.`);
        continue;
      }

      let userId: string | undefined;
      if (i === 0) {
        // Configure primary account (system_default_user)
        const defaultUser = db
          .prepare('SELECT id FROM users WHERE id = ? OR username = ?')
          .get('system_default_user', 'admin') as { id?: string } | undefined;
        if (defaultUser?.id === 'system_default_user') {
          db.prepare('UPDATE users SET username = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(
            spec.username,
            passwordHash,
            now,
            defaultUser.id
          );
          deps.log(`[aionui-web] Primary account configured: username="${spec.username}"`);
          continue;
        }
        if (!defaultUser) userId = 'system_default_user';
      }

      // Create additional user
      userId ??= `user_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)`
      ).run(userId, spec.username, passwordHash, now, now);

      deps.log(`[aionui-web] Additional account created: username="${spec.username}"`);
    }
  } catch (err) {
    deps.warn(`[aionui-web] ensureUsers error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    db?.close?.();
  }
}
