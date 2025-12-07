/**
 * Database Module - Works with both better-sqlite3 (local) and D1 (Cloudflare)
 * Uses Drizzle for schema definitions and raw SQL for queries
 */

import type { D1Database } from '@cloudflare/workers-types';

export * from './schema';

// Row types matching raw SQL column names (snake_case)
export interface UserRow {
  id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  is_admin: number;
  provider: string | null;
  provider_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface CardRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator: string | null;
  creator_notes: string | null;
  head_version_id: string | null;
  visibility: 'public' | 'nsfw_only' | 'unlisted' | 'blocked';
  moderation_state: 'ok' | 'review' | 'blocked';
  upvotes: number;
  downvotes: number;
  favorites_count: number;
  downloads_count: number;
  comments_count: number;
  forks_count: number;
  uploader_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface CardVersionRow {
  id: string;
  card_id: string;
  parent_version_id: string | null;
  forked_from_id: string | null;
  storage_url: string;
  content_hash: string;
  spec_version: string;
  source_format: string;
  tokens_description: number;
  tokens_personality: number;
  tokens_scenario: number;
  tokens_mes_example: number;
  tokens_first_mes: number;
  tokens_system_prompt: number;
  tokens_post_history: number;
  tokens_total: number;
  has_alt_greetings: number;
  alt_greetings_count: number;
  has_lorebook: number;
  lorebook_entries_count: number;
  has_embedded_images: number;
  embedded_images_count: number;
  has_assets: number;
  assets_count: number;
  saved_assets: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  thumbnail_path: string | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  card_data: string;
  created_at: number;
}

export interface TagRow {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  usage_count: number;
}

export interface VoteRow {
  user_id: string;
  card_id: string;
  vote: number;
  created_at: number;
}

export interface FavoriteRow {
  user_id: string;
  card_id: string;
  created_at: number;
}

export interface CommentRow {
  id: string;
  card_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

// Combined type for card with version
export interface CardWithVersionRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator: string | null;
  creator_notes: string | null;
  head_version_id: string | null;
  visibility: 'public' | 'nsfw_only' | 'unlisted' | 'blocked';
  moderation_state: 'ok' | 'review' | 'blocked';
  upvotes: number;
  downvotes: number;
  favorites_count: number;
  downloads_count: number;
  comments_count: number;
  forks_count: number;
  uploader_id: string | null;
  created_at: number;
  updated_at: number;
  version_id: string;
  storage_url: string;
  content_hash: string;
  spec_version: string;
  source_format: string;
  tokens_description: number;
  tokens_personality: number;
  tokens_scenario: number;
  tokens_mes_example: number;
  tokens_first_mes: number;
  tokens_system_prompt: number;
  tokens_post_history: number;
  tokens_total: number;
  has_alt_greetings: number;
  alt_greetings_count: number;
  has_lorebook: number;
  lorebook_entries_count: number;
  has_embedded_images: number;
  embedded_images_count: number;
  has_assets: number;
  assets_count: number;
  saved_assets: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  thumbnail_path: string | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  card_data: string;
  version_created_at: number;
  forked_from_version_id: string | null;
}

// Unified database interface that works sync (better-sqlite3) or async (D1)
export interface DbStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface UnifiedDb {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
}

// Local SQLite instance (cached)
let localDb: UnifiedDb | null = null;

/**
 * Check if running on Cloudflare
 */
export function isCloudflareRuntime(): boolean {
  return typeof globalThis !== 'undefined' && 'caches' in globalThis && !process.env.DATABASE_PATH;
}

/**
 * Get database for local development (better-sqlite3)
 * Returns sync API
 * @deprecated Use getAsyncDb() instead
 * This function should NEVER be called on Cloudflare Workers.
 */
export function getDb(): UnifiedDb {
  if (localDb) return localDb;

  // Use new Function to completely hide the require from static analysis
  // This is more robust than eval('require') for hiding from bundlers
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicRequire = new Function('moduleName', 'return require(moduleName)');
  const Database = dynamicRequire('better-sqlite3');
  const { readFileSync } = dynamicRequire('fs');
  const { join } = dynamicRequire('path');

  const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'cardshub.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Run schema
  const schemaPath = join(process.cwd(), 'src/lib/db/schema.sql');
  try {
    const sqlSchema = readFileSync(schemaPath, 'utf-8');
    sqlite.exec(sqlSchema);
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
  }

  localDb = sqlite as UnifiedDb;
  return localDb;
}

// Alias for backwards compatibility
export const getDbSync = getDb;

/**
 * Get raw D1 database (for Cloudflare runtime)
 */
export function getD1(d1: D1Database): D1Database {
  return d1;
}

/**
 * Close local database connection
 */
export function closeDb(): void {
  if (localDb) {
    (localDb as any).close?.();
    localDb = null;
  }
}

/**
 * Run a transaction (local only - D1 uses batches)
 * @deprecated Use getAsyncDb().transaction() instead
 */
export function transaction<T>(fn: (db: UnifiedDb) => T): T {
  const db = getDb();
  return (db as any).transaction(() => fn(db))();
}

// FTS functions (local only)
export function rebuildFtsIndex(): void {
  if (isCloudflareRuntime()) return;
  const db = getDb();
  (db as any).transaction(() => {
    (db as any).exec('DELETE FROM cards_fts');
    (db as any).exec(`
      INSERT INTO cards_fts(card_id, name, description, creator, creator_notes)
      SELECT id, name, COALESCE(description, ''), COALESCE(creator, ''), COALESCE(creator_notes, '')
      FROM cards
    `);
  })();
}

export function updateFtsIndex(
  cardId: string,
  name: string,
  description: string | null,
  creator: string | null,
  creatorNotes: string | null
): void {
  if (isCloudflareRuntime()) return;
  const db = getDb();
  (db as any).transaction(() => {
    db.prepare('DELETE FROM cards_fts WHERE card_id = ?').run(cardId);
    db.prepare(`
      INSERT INTO cards_fts(card_id, name, description, creator, creator_notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(cardId, name, description || '', creator || '', creatorNotes || '');
  })();
}

export function removeFtsIndex(cardId: string): void {
  if (isCloudflareRuntime()) return;
  const db = getDb();
  db.prepare('DELETE FROM cards_fts WHERE card_id = ?').run(cardId);
}
