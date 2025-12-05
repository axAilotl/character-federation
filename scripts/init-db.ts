#!/usr/bin/env npx tsx

/**
 * Initialize the CardsHub database
 *
 * Usage:
 *   npx tsx scripts/init-db.ts          # Initialize (preserves existing data)
 *   npx tsx scripts/init-db.ts --reset  # Drop and recreate (destroys all data)
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'cardshub.db');
const SCHEMA_PATH = join(process.cwd(), 'src/lib/db/schema.sql');

const isReset = process.argv.includes('--reset');

console.log('CardsHub Database Initialization');
console.log('================================');
console.log(`Database path: ${DB_PATH}`);
console.log(`Schema path: ${SCHEMA_PATH}`);
console.log(`Mode: ${isReset ? 'RESET (all data will be deleted!)' : 'Initialize'}`);
console.log('');

// Reset mode: delete existing database
if (isReset && existsSync(DB_PATH)) {
  console.log('Removing existing database...');
  unlinkSync(DB_PATH);

  // Also remove WAL files if they exist
  if (existsSync(`${DB_PATH}-wal`)) unlinkSync(`${DB_PATH}-wal`);
  if (existsSync(`${DB_PATH}-shm`)) unlinkSync(`${DB_PATH}-shm`);

  console.log('Done.');
}

// Create/open database
console.log('Opening database...');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Check if database has existing tables (migrations needed)
const hasCardsTable = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name='cards'
`).get();

if (hasCardsTable) {
  // Run migrations FIRST for existing databases (before schema applies CHECK constraints)
  console.log('Running migrations on existing database...');
  const migrations = [
    `ALTER TABLE cards ADD COLUMN creator TEXT`,
    `ALTER TABLE cards ADD COLUMN creator_notes TEXT`,
    `ALTER TABLE cards ADD COLUMN thumbnail_path TEXT`,
    `ALTER TABLE cards ADD COLUMN thumbnail_width INTEGER`,
    `ALTER TABLE cards ADD COLUMN thumbnail_height INTEGER`,
    `ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`,
    `ALTER TABLE cards ADD COLUMN source_format TEXT NOT NULL DEFAULT 'png'`,
    `ALTER TABLE cards ADD COLUMN has_assets INTEGER DEFAULT 0`,
    `ALTER TABLE cards ADD COLUMN assets_count INTEGER DEFAULT 0`,
    `ALTER TABLE cards ADD COLUMN saved_assets TEXT`,
    `ALTER TABLE cards ADD COLUMN head_version_id TEXT`,
    `ALTER TABLE cards ADD COLUMN visibility TEXT DEFAULT 'public'`,
    `ALTER TABLE cards ADD COLUMN moderation_state TEXT DEFAULT 'ok'`,
    `ALTER TABLE cards ADD COLUMN forks_count INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      storage_url TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
      access_token_hash TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS idx_uploads_path ON uploads(path)`,
    `CREATE INDEX IF NOT EXISTS idx_uploads_uploader ON uploads(uploader_id)`,
    `CREATE INDEX IF NOT EXISTS idx_uploads_visibility ON uploads(visibility)`,
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
      console.log(`  Applied: ${sql.substring(0, 60)}...`);
    } catch {
      // Column already exists
    }
  }
}

// Read and execute schema (creates tables that don't exist, inserts default tags)
console.log('Applying schema...');
const schema = readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// Create FTS5 virtual table if it doesn't exist (standalone, no content= to avoid corruption)
console.log('Creating FTS5 virtual table...');
try {
  // Drop old content-linked FTS table if it exists (causes corruption)
  const tableInfo = db.prepare(`
    SELECT sql FROM sqlite_master WHERE name = 'cards_fts' AND type = 'table'
  `).get() as { sql: string } | undefined;

  if (tableInfo?.sql?.includes("content='cards'") || tableInfo?.sql?.includes('content="cards"')) {
    console.log('  Dropping old content-linked FTS table...');
    db.exec('DROP TABLE IF EXISTS cards_fts');
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      card_id UNINDEXED,
      name,
      description,
      creator,
      creator_notes,
      tokenize='porter unicode61 remove_diacritics 1'
    )
  `);
  console.log('  FTS5 table ready');
} catch (error) {
  console.log('  FTS5 table:', error instanceof Error ? error.message : error);
}

// Optionally create admin user if explicitly configured
const allowBootstrap = process.env.ALLOW_AUTO_ADMIN === 'true' || process.env.NODE_ENV === 'development';
const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (allowBootstrap && bootstrapPassword) {
  console.log('Creating admin user...');
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const passwordHash = bcrypt.hashSync(bootstrapPassword, 12);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, is_admin, provider)
      VALUES (?, 'admin', ?, 1, 'email')
    `).run(nanoid(), passwordHash);
    console.log('  Created admin user with provided ADMIN_BOOTSTRAP_PASSWORD');
  } else {
    console.log('  Admin user already exists');
  }
} else {
  console.log('Skipping admin bootstrap (set ALLOW_AUTO_ADMIN=true and ADMIN_BOOTSTRAP_PASSWORD to enable)');
}

// Initialize FTS index
console.log('Initializing FTS5 search index...');
try {
  const ftsCount = (db.prepare('SELECT COUNT(*) as count FROM cards_fts').get() as { count: number }).count;
  const cardsCount = (db.prepare('SELECT COUNT(*) as count FROM cards').get() as { count: number }).count;

  if (ftsCount === 0 && cardsCount > 0) {
    console.log(`  Populating FTS index with ${cardsCount} cards...`);
    db.transaction(() => {
      db.exec(`DELETE FROM cards_fts`);
      db.exec(`
        INSERT INTO cards_fts(card_id, name, description, creator, creator_notes)
        SELECT id, name, COALESCE(description, ''), COALESCE(creator, ''), COALESCE(creator_notes, '')
        FROM cards
      `);
    })();
    console.log('  FTS index populated');
  } else if (cardsCount === 0) {
    console.log('  No cards to index');
  } else {
    console.log(`  FTS index already has ${ftsCount} entries`);
  }
} catch (error) {
  console.log('  FTS initialization:', error instanceof Error ? error.message : error);
}

// Print summary
console.log('');
console.log('Database Summary:');
console.log('-----------------');

const counts = {
  users: (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count,
  cards: (db.prepare('SELECT COUNT(*) as count FROM cards').get() as { count: number }).count,
  tags: (db.prepare('SELECT COUNT(*) as count FROM tags').get() as { count: number }).count,
  sessions: (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count,
};

console.log(`  Users: ${counts.users}`);
console.log(`  Cards: ${counts.cards}`);
console.log(`  Tags: ${counts.tags}`);
console.log(`  Sessions: ${counts.sessions}`);

db.close();

console.log('');
console.log('Database initialization complete!');
