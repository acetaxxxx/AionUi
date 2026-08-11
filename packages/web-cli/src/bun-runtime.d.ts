/**
 * Minimal declarations for the Bun APIs used by the standalone web CLI.
 * Runtime support is provided by Bun; this package intentionally does not
 * depend on @types/bun because the CLI is also compiled/run under Node.
 */
declare const Bun:
  | {
      password?: {
        hash(password: string, options: { algorithm: 'bcrypt'; cost: number }): Promise<string>;
      };
    }
  | undefined;

declare module 'bun:sqlite' {
  export class Database {
    constructor(filename: string);
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): unknown;
    };
    close(): void;
  }
}
