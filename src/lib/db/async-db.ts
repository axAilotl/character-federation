/**
 * Async Database Wrapper
 *
 * Provides a unified async interface for both:
 * - better-sqlite3 (local development) - wraps sync calls in promises
 * - Cloudflare D1 (production) - uses native async API
 */

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

// Result types
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// Unified async statement interface
export interface AsyncStatement {
  run(...params: unknown[]): Promise<RunResult>;
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>;
  all<T = unknown>(...params: unknown[]): Promise<T[]>;
}

// Unified async database interface
export interface AsyncDb {
  prepare(sql: string): AsyncStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<RunResult[]>;
}

// Cache for local database instance
let localDbInstance: AsyncDb | null = null;

/**
 * Check if running on Cloudflare
 */
export function isCloudflare(): boolean {
  return typeof globalThis !== 'undefined' && 'caches' in globalThis && !process.env.DATABASE_PATH;
}

/**
 * Wrap better-sqlite3 for async interface (local development)
 */
function wrapBetterSqlite(db: any): AsyncDb {
  return {
    prepare(sql: string): AsyncStatement {
      const stmt = db.prepare(sql);
      return {
        async run(...params: unknown[]): Promise<RunResult> {
          const result = stmt.run(...params);
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        async get<T = unknown>(...params: unknown[]): Promise<T | undefined> {
          return stmt.get(...params) as T | undefined;
        },
        async all<T = unknown>(...params: unknown[]): Promise<T[]> {
          return stmt.all(...params) as T[];
        },
      };
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      // better-sqlite3 transactions are sync but we need async wrapper
      return db.transaction(async () => {
        return await fn();
      })();
    },
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<RunResult[]> {
      const results: RunResult[] = [];
      db.transaction(() => {
        for (const { sql, params } of statements) {
          const stmt = db.prepare(sql);
          const result = stmt.run(...(params || []));
          results.push({
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          });
        }
      })();
      return results;
    },
  };
}

/**
 * Wrap D1 for async interface (Cloudflare production)
 */
function wrapD1(db: D1Database): AsyncDb {
  return {
    prepare(sql: string): AsyncStatement {
      const stmt = db.prepare(sql);
      return {
        async run(...params: unknown[]): Promise<RunResult> {
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          const result = await bound.run();
          return {
            changes: result.meta?.changes ?? 0,
            lastInsertRowid: result.meta?.last_row_id ?? 0,
          };
        },
        async get<T = unknown>(...params: unknown[]): Promise<T | undefined> {
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          const result = await bound.first<T>();
          return result ?? undefined;
        },
        async all<T = unknown>(...params: unknown[]): Promise<T[]> {
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          const result = await bound.all<T>();
          return result.results;
        },
      };
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      // WARNING: D1 does not support standard interactive transactions.
      // This function simply executes the callback.
      // Operations within this callback are NOT atomic and NOT isolated.
      // Use db.batch() for atomic writes if possible.
      return await fn();
    },
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<RunResult[]> {
      const preparedStatements = statements.map(({ sql, params }) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.bind(...params) : stmt;
      });
      
      const results = await db.batch(preparedStatements);
      
      return results.map(result => ({
        changes: result.meta?.changes ?? 0,
        lastInsertRowid: result.meta?.last_row_id ?? 0,
      }));
    },
  };
}

/**
 * Get async database for local development (better-sqlite3)
 * This function should NEVER be called on Cloudflare Workers.
 */
export function getAsyncDb(): AsyncDb {
  if (localDbInstance) return localDbInstance;

  // Use new Function to completely hide the require from static analysis
  // This is more robust than eval('require') for hiding from bundlers
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicRequire = new Function('moduleName', 'return require(moduleName)');
  const Database = dynamicRequire('better-sqlite3');
  const { readFileSync } = dynamicRequire('fs');
  const { join } = dynamicRequire('path');

  const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'cardshub.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schemaPath = join(process.cwd(), 'src/lib/db/schema.sql');
  try {
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
  }

  localDbInstance = wrapBetterSqlite(db);
  return localDbInstance;
}

/**
 * Get async database from D1 binding (Cloudflare production)
 */
export function getAsyncD1Db(d1: D1Database): AsyncDb {
  return wrapD1(d1);
}

/**
 * Close local database connection
 */
export function closeAsyncDb(): void {
  localDbInstance = null;
}

// Cached D1-wrapped database for Cloudflare
let cachedD1Db: AsyncDb | null = null;

/**
 * Get database instance (unified helper for both environments)
 * Call this from API routes - handles both local and Cloudflare
 */
export async function getDatabase(): Promise<AsyncDb> {
  if (isCloudflare()) {
    // On Cloudflare, get D1 from request context
    if (cachedD1Db) return cachedD1Db;

    // Dynamic import to avoid build issues
    const { getD1 } = await import('@/lib/cloudflare/env');
    const d1 = await getD1();
    if (!d1) {
      throw new Error('D1 database binding not available');
    }
    cachedD1Db = wrapD1(d1);
    return cachedD1Db;
  }
  // Local development with better-sqlite3
  return getAsyncDb();
}