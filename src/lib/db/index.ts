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
  processing_status: 'complete' | 'pending' | 'processing' | 'failed' | null;
  upload_id: string | null;
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
  processing_status: 'complete' | 'pending' | 'processing' | 'failed' | null;
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
  // v1.2: Collection fields (from JOIN)
  collection_id: string | null;
  collection_slug: string | null;
  collection_name: string | null;
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
 * @deprecated Use getDatabase() from ./async-db instead
 * This function should NEVER be called on Cloudflare Workers.
 */
export async function getDb(): Promise<UnifiedDb> {
  // CRITICAL: Must check BEFORE any dynamic imports to prevent fs/better-sqlite3 from loading on Workers
  if (isCloudflareRuntime()) {
    throw new Error('getDb() is not supported on Cloudflare Workers. Use getDatabase() from async-db instead.');
  }

  if (localDb) return localDb;

  // Dynamic import for Node.js modules - works with Next.js bundling
  const [betterSqlite, fsModule, pathModule] = await Promise.all([
    import('better-sqlite3'),
    import('fs'),
    import('path'),
  ]);

  const Database = betterSqlite.default;
  const { readFileSync } = fsModule;
  const { join } = pathModule;

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

// Alias for backwards compatibility - now also async
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
 * @deprecated Use getDatabase().transaction() from ./async-db instead
 */
export async function transaction<T>(fn: (db: UnifiedDb) => T): Promise<T> {
  // This function should NEVER be called on Cloudflare Workers
  if (isCloudflareRuntime()) {
    throw new Error('transaction() is not supported on Cloudflare Workers. Use getDatabase().transaction() instead.');
  }
  const db = await getDb();
  return (db as any).transaction(() => fn(db))();
}

// FTS functions (works on local SQLite only - D1 doesn't support FTS5)
// IMPORTANT: Must check isCloudflareRuntime() BEFORE calling getDb() to avoid
// triggering dynamic imports of fs/better-sqlite3 which crash on Workers
export async function rebuildFtsIndex(): Promise<void> {
  // Skip on Cloudflare - FTS5 not supported on D1
  if (isCloudflareRuntime()) return;

  try {
    const db = await getDb();
    await db.prepare('DELETE FROM cards_fts').run();
    await db.prepare(`
      INSERT INTO cards_fts(card_id, name, description, creator, creator_notes)
      SELECT id, name, COALESCE(description, ''), COALESCE(creator, ''), COALESCE(creator_notes, '')
      FROM cards
      WHERE visibility = 'public'
    `).run();
  } catch (error) {
    console.warn('[FTS] rebuildFtsIndex failed:', error);
  }
}

export async function updateFtsIndex(
  cardId: string,
  name: string,
  description: string | null,
  creator: string | null,
  creatorNotes: string | null
): Promise<void> {
  // Skip on Cloudflare - FTS5 not supported on D1
  if (isCloudflareRuntime()) return;

  try {
    const db = await getDb();
    // Delete existing entry first
    await db.prepare('DELETE FROM cards_fts WHERE card_id = ?').run(cardId);
    // Insert new entry
    await db.prepare(`
      INSERT INTO cards_fts(card_id, name, description, creator, creator_notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(cardId, name, description || '', creator || '', creatorNotes || '');
  } catch (error) {
    console.debug('[FTS] updateFtsIndex skipped:', error);
  }
}

export async function removeFtsIndex(cardId: string): Promise<void> {
  // Skip on Cloudflare - FTS5 not supported on D1
  if (isCloudflareRuntime()) return;

  try {
    const db = await getDb();
    await db.prepare('DELETE FROM cards_fts WHERE card_id = ?').run(cardId);
  } catch (error) {
    console.debug('[FTS] removeFtsIndex skipped:', error);
  }
}
