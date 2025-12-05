/**
 * Database Driver Abstraction
 *
 * Supports both:
 * - better-sqlite3 (local development, synchronous)
 * - Cloudflare D1 (production, async)
 *
 * All public APIs are async for compatibility.
 */

import type { D1Database } from '@cloudflare/workers-types';

// Check if we're in Cloudflare Workers environment
const isCloudflare = typeof globalThis !== 'undefined' &&
  'caches' in globalThis &&
  typeof (globalThis as Record<string, unknown>).caches === 'object';

// Statement result types
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// Unified prepared statement interface
export interface PreparedStatement<T = unknown> {
  bind(...values: unknown[]): PreparedStatement<T>;
  get(): Promise<T | undefined>;
  all(): Promise<T[]>;
  run(): Promise<RunResult>;
}

// Unified database interface
export interface Database {
  prepare<T = unknown>(query: string): PreparedStatement<T>;
  exec(query: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// better-sqlite3 wrapper (sync -> async)
class BetterSqliteStatement<T> implements PreparedStatement<T> {
  private boundValues: unknown[] = [];

  constructor(
    private db: import('better-sqlite3').Database,
    private query: string
  ) {}

  bind(...values: unknown[]): PreparedStatement<T> {
    this.boundValues = values;
    return this;
  }

  async get(): Promise<T | undefined> {
    const stmt = this.db.prepare(this.query);
    return stmt.get(...this.boundValues) as T | undefined;
  }

  async all(): Promise<T[]> {
    const stmt = this.db.prepare(this.query);
    return stmt.all(...this.boundValues) as T[];
  }

  async run(): Promise<RunResult> {
    const stmt = this.db.prepare(this.query);
    const result = stmt.run(...this.boundValues);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }
}

class BetterSqliteDatabase implements Database {
  constructor(private db: import('better-sqlite3').Database) {}

  prepare<T = unknown>(query: string): PreparedStatement<T> {
    return new BetterSqliteStatement<T>(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // better-sqlite3 transactions are sync, but we wrap for compatibility
    return this.db.transaction(async () => {
      return fn();
    })();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// D1 wrapper
class D1Statement<T> implements PreparedStatement<T> {
  private stmt: ReturnType<D1Database['prepare']>;

  constructor(db: D1Database, query: string) {
    this.stmt = db.prepare(query);
  }

  bind(...values: unknown[]): PreparedStatement<T> {
    this.stmt = this.stmt.bind(...values);
    return this;
  }

  async get(): Promise<T | undefined> {
    const result = await this.stmt.first<T>();
    return result ?? undefined;
  }

  async all(): Promise<T[]> {
    const result = await this.stmt.all<T>();
    return result.results;
  }

  async run(): Promise<RunResult> {
    const result = await this.stmt.run();
    return {
      changes: result.meta?.changes ?? 0,
      lastInsertRowid: result.meta?.last_row_id ?? 0,
    };
  }
}

class D1DatabaseWrapper implements Database {
  constructor(private db: D1Database) {}

  prepare<T = unknown>(query: string): PreparedStatement<T> {
    return new D1Statement<T>(this.db, query);
  }

  async exec(query: string): Promise<void> {
    await this.db.exec(query);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // WARNING: D1 does not support standard transactions.
    // This function simply executes the callback.
    // Operations within this callback are NOT atomic and NOT isolated.
    // Use db.batch() for atomic writes if possible.
    return fn();
  }

  async close(): Promise<void> {
    // D1 connections are managed by the runtime
  }
}

// Singleton instances
let dbInstance: Database | null = null;
let betterSqliteDb: import('better-sqlite3').Database | null = null;

/**
 * Initialize database with D1 binding (for Cloudflare Workers)
 */
export function initD1(d1: D1Database): Database {
  dbInstance = new D1DatabaseWrapper(d1);
  return dbInstance;
}

/**
 * Initialize database with better-sqlite3 (for local development)
 */
export async function initBetterSqlite(dbPath?: string): Promise<Database> {
  if (betterSqliteDb) {
    return new BetterSqliteDatabase(betterSqliteDb);
  }

  const Database = (await import('better-sqlite3')).default;
  const { join } = await import('path');

  const path = dbPath || join(process.cwd(), 'cardshub.db');
  betterSqliteDb = new Database(path);
  betterSqliteDb.pragma('journal_mode = WAL');
  betterSqliteDb.pragma('foreign_keys = ON');

  dbInstance = new BetterSqliteDatabase(betterSqliteDb);
  return dbInstance;
}

/**
 * Get the current database instance
 */
export function getDatabase(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initD1() or initBetterSqlite() first.');
  }
  return dbInstance;
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return dbInstance !== null;
}

/**
 * Get raw better-sqlite3 instance (for migrations, only works in Node.js)
 */
export function getRawBetterSqlite(): import('better-sqlite3').Database | null {
  return betterSqliteDb;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    betterSqliteDb = null;
  }
}

// Export environment check
export { isCloudflare };
