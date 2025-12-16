-- CardsHub Database Schema
-- SQLite with better-sqlite3

-- Users (optional auth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT, -- v1.1: User bio/about section
  profile_css TEXT, -- v1.1: Custom CSS for profile page
  password_hash TEXT,
  is_admin INTEGER DEFAULT 0,
  provider TEXT, -- 'email', 'google', 'discord', 'github'
  provider_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Card identity (stable URL, ownership, stats)
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  creator TEXT,
  creator_notes TEXT,

  -- Current head version (points to card_versions.id)
  head_version_id TEXT,

  -- Visibility and moderation state
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'nsfw_only', 'unlisted', 'blocked')),
  moderation_state TEXT DEFAULT 'ok' CHECK (moderation_state IN ('ok', 'review', 'blocked')),

  -- Stats (denormalized for performance)
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  favorites_count INTEGER DEFAULT 0,
  downloads_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  forks_count INTEGER DEFAULT 0,

  -- v1.3: Generated column for trending sort (virtual = computed on read)
  trending_score REAL GENERATED ALWAYS AS (upvotes + downloads_count * 0.5) VIRTUAL,

  -- Relationships
  uploader_id TEXT REFERENCES users(id),

  -- v1.2: Collection membership
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  collection_item_id TEXT,  -- Character UUID from Voxta package

  -- v1.4: Large file upload processing status
  -- 'complete' = ready, 'pending' = awaiting chunks, 'processing' = extracting assets, 'failed' = error
  processing_status TEXT DEFAULT 'complete' CHECK (processing_status IN ('complete', 'pending', 'processing', 'failed')),
  upload_id TEXT,  -- R2 multipart upload ID (null when complete)

  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Immutable version snapshots
CREATE TABLE IF NOT EXISTS card_versions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,

  -- Lineage
  parent_version_id TEXT REFERENCES card_versions(id), -- previous edit in this card
  forked_from_id TEXT REFERENCES card_versions(id),    -- if forked from another card's version

  -- Storage
  storage_url TEXT NOT NULL,    -- file://, s3://, ipfs://
  content_hash TEXT NOT NULL,   -- SHA-256 of raw uploaded bytes

  -- Spec info
  spec_version TEXT NOT NULL, -- 'v2', 'v3'
  source_format TEXT NOT NULL DEFAULT 'png', -- 'png', 'json', 'charx', 'voxta'

  -- Token counts (computed on upload)
  tokens_description INTEGER DEFAULT 0,
  tokens_personality INTEGER DEFAULT 0,
  tokens_scenario INTEGER DEFAULT 0,
  tokens_mes_example INTEGER DEFAULT 0,
  tokens_first_mes INTEGER DEFAULT 0,
  tokens_system_prompt INTEGER DEFAULT 0,
  tokens_post_history INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,

  -- Metadata flags
  has_alt_greetings INTEGER DEFAULT 0,
  alt_greetings_count INTEGER DEFAULT 0,
  has_lorebook INTEGER DEFAULT 0,
  lorebook_entries_count INTEGER DEFAULT 0,
  has_embedded_images INTEGER DEFAULT 0,
  embedded_images_count INTEGER DEFAULT 0,

  -- Asset tracking (for charx/voxta/v3 cards)
  has_assets INTEGER DEFAULT 0,
  assets_count INTEGER DEFAULT 0,
  saved_assets TEXT, -- JSON array of extracted asset paths

  -- Image
  image_path TEXT,
  image_width INTEGER,
  image_height INTEGER,

  -- Thumbnail (webp, max 300px)
  thumbnail_path TEXT,
  thumbnail_width INTEGER,
  thumbnail_height INTEGER,

  -- Raw card data (JSON) - for quick access without fetching blob
  card_data TEXT NOT NULL,

  created_at INTEGER DEFAULT (unixepoch())
);

-- Reports (for moderation)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at INTEGER DEFAULT (unixepoch())
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  category TEXT, -- 'genre', 'pov', 'rating', 'theme', etc.
  usage_count INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0 -- If 1, cards with this tag cannot be uploaded
);

-- Card Tags (many-to-many)
CREATE TABLE IF NOT EXISTS card_tags (
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);

-- Votes
CREATE TABLE IF NOT EXISTS votes (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  vote INTEGER NOT NULL, -- 1 = upvote, -1 = downvote
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, card_id)
);

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, card_id)
);

-- Downloads (tracking)
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  format TEXT NOT NULL, -- 'png', 'json'
  ip_hash TEXT, -- for anonymous rate limiting
  created_at INTEGER DEFAULT (unixepoch())
);

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- v1.1: Tag Preferences (follow/block tags per user)
CREATE TABLE IF NOT EXISTS tag_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  preference TEXT NOT NULL CHECK (preference IN ('follow', 'block')),
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, tag_id)
);

-- v1.1: User Follows (social following system)
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (follower_id, following_id)
);

-- v1.2: Collections (multi-character packages, e.g., Voxta)
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  creator TEXT,
  explicit_content INTEGER DEFAULT 0,  -- NSFW from Voxta ExplicitContent

  -- Voxta package.json fields
  package_id TEXT UNIQUE,              -- For matching on re-upload
  package_version TEXT,
  entry_resource_kind INTEGER,
  entry_resource_id TEXT,
  thumbnail_resource_kind INTEGER,
  thumbnail_resource_id TEXT,
  date_created TEXT,                   -- Original package dates
  date_modified TEXT,

  -- Storage
  storage_url TEXT NOT NULL,           -- Original .voxpkg

  -- Display
  thumbnail_path TEXT,
  thumbnail_width INTEGER,
  thumbnail_height INTEGER,

  -- Ownership
  uploader_id TEXT REFERENCES users(id),
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'nsfw_only', 'unlisted', 'blocked')),

  -- Stats (tracked separately, not aggregated)
  items_count INTEGER DEFAULT 0,
  downloads_count INTEGER DEFAULT 0,

  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cards_created_at ON cards(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_downloads ON cards(downloads_count DESC);
CREATE INDEX IF NOT EXISTS idx_cards_upvotes ON cards(upvotes DESC);
CREATE INDEX IF NOT EXISTS idx_cards_slug ON cards(slug);
CREATE INDEX IF NOT EXISTS idx_cards_uploader ON cards(uploader_id);
CREATE INDEX IF NOT EXISTS idx_cards_visibility ON cards(visibility);
CREATE INDEX IF NOT EXISTS idx_cards_head_version ON cards(head_version_id);

CREATE INDEX IF NOT EXISTS idx_versions_card ON card_versions(card_id);
CREATE INDEX IF NOT EXISTS idx_versions_hash ON card_versions(content_hash);
CREATE INDEX IF NOT EXISTS idx_versions_forked ON card_versions(forked_from_id);
CREATE INDEX IF NOT EXISTS idx_versions_parent ON card_versions(parent_version_id);

CREATE INDEX IF NOT EXISTS idx_card_tags_card ON card_tags(card_id);
CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id);
CREATE INDEX IF NOT EXISTS idx_votes_card ON votes(card_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_card ON favorites(card_id);
CREATE INDEX IF NOT EXISTS idx_downloads_card ON downloads(card_id);

-- Uploads metadata (for asset visibility)
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  storage_url TEXT NOT NULL,
  path TEXT UNIQUE NOT NULL,
  uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
  access_token_hash TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_uploads_path ON uploads(path);
CREATE INDEX IF NOT EXISTS idx_uploads_uploader ON uploads(uploader_id);
CREATE INDEX IF NOT EXISTS idx_uploads_visibility ON uploads(visibility);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- Settings (key-value store for app configuration)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_reports_card ON reports(card_id);

-- v1.1: Tag Preferences indexes
CREATE INDEX IF NOT EXISTS idx_tag_prefs_user ON tag_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_tag_prefs_tag ON tag_preferences(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_prefs_preference ON tag_preferences(preference);

-- v1.1: User Follows indexes
CREATE INDEX IF NOT EXISTS idx_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows(following_id);

-- v1.2: Collections indexes
CREATE INDEX IF NOT EXISTS idx_collections_package_id ON collections(package_id);
CREATE INDEX IF NOT EXISTS idx_collections_uploader ON collections(uploader_id);
CREATE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);
CREATE INDEX IF NOT EXISTS idx_collections_visibility ON collections(visibility);
CREATE INDEX IF NOT EXISTS idx_cards_collection ON cards(collection_id);

-- v1.3: Rate limiting (persistent for serverless/edge)
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  window_ms INTEGER NOT NULL
);

-- v1.4: Admin Settings (feature toggles and site configuration)
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER DEFAULT (unixepoch()),
  updated_by TEXT REFERENCES users(id)
);

-- Default admin settings
INSERT OR IGNORE INTO admin_settings (key, value, description) VALUES
  ('image_proxy_enabled', 'true', 'Enable image proxy for external images (bypass hotlink protection)'),
  ('image_cache_enabled', 'true', 'Cache external images at upload time'),
  ('registration_enabled', 'true', 'Allow new user registration'),
  ('uploads_enabled', 'true', 'Allow card uploads'),
  ('allow_anon_uploads', 'false', 'Allow anonymous users to upload cards without logging in'),
  ('maintenance_mode', 'false', 'Put site in maintenance mode (admin-only access)');

-- Index on trending score for fast ORDER BY
-- NOTE: Requires trending_score generated column on cards table (added via migration)
CREATE INDEX IF NOT EXISTS idx_cards_trending ON cards(trending_score DESC);

-- Full-text search index (FTS5)
-- Indexes card name, description, creator, and creator_notes for fast search
-- Note: D1 does not support FTS5 - queries fall back to LIKE search on Cloudflare
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  card_id,
  name,
  description,
  creator,
  creator_notes,
  tokenize='porter unicode61 remove_diacritics 1'
);

-- Full-text search index for collections (FTS5)
-- Indexes collection name, description, and creator for fast search
-- Note: D1 does not support FTS5 - queries fall back to LIKE search on Cloudflare
CREATE VIRTUAL TABLE IF NOT EXISTS collections_fts USING fts5(
  collection_id,
  name,
  description,
  creator,
  tokenize='porter unicode61 remove_diacritics 1'
);

-- Insert default tags
INSERT OR IGNORE INTO tags (name, slug, category) VALUES
  -- POV
  ('Any POV', 'any-pov', 'pov'),
  ('Male POV', 'male-pov', 'pov'),
  ('Female POV', 'female-pov', 'pov'),
  ('Third Person', 'third-person', 'pov'),

  -- Gender
  ('Male', 'male', 'gender'),
  ('Female', 'female', 'gender'),
  ('Nonbinary', 'nonbinary', 'gender'),
  ('Futa', 'futa', 'gender'),

  -- Genre
  ('Fantasy', 'fantasy', 'genre'),
  ('Sci-Fi', 'sci-fi', 'genre'),
  ('Modern', 'modern', 'genre'),
  ('Historical', 'historical', 'genre'),
  ('Horror', 'horror', 'genre'),
  ('Romance', 'romance', 'genre'),
  ('Comedy', 'comedy', 'genre'),
  ('Action', 'action', 'genre'),
  ('Mystery', 'mystery', 'genre'),
  ('Slice of Life', 'slice-of-life', 'genre'),

  -- Type
  ('Original', 'original', 'type'),
  ('Anime', 'anime', 'type'),
  ('Game', 'game', 'type'),
  ('Movie/TV', 'movie-tv', 'type'),
  ('VTuber', 'vtuber', 'type'),

  -- Content
  ('SFW', 'sfw', 'rating'),
  ('NSFW', 'nsfw', 'rating'),
  ('Fluff', 'fluff', 'theme'),
  ('Angst', 'angst', 'theme'),
  ('Isekai', 'isekai', 'theme'),

  -- Character Types
  ('Human', 'human', 'species'),
  ('Monster', 'monster', 'species'),
  ('Furry', 'furry', 'species'),
  ('Robot', 'robot', 'species'),
  ('Elf', 'elf', 'species'),
  ('Vampire', 'vampire', 'species'),
  ('Demon', 'demon', 'species'),
  ('Angel', 'angel', 'species'),

  -- v1.2: Format tags
  ('Collection', 'collection', 'format');
