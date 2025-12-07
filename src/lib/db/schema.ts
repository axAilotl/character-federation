import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

// Users
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  username: text('username').unique().notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'), // v1.1: User bio/about section
  profileCss: text('profile_css'), // v1.1: Custom CSS for profile page
  passwordHash: text('password_hash'),
  isAdmin: integer('is_admin').default(0),
  provider: text('provider'),
  providerId: text('provider_id'),
  createdAt: integer('created_at').default(0),
  updatedAt: integer('updated_at').default(0),
});

// Cards
export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  creator: text('creator'),
  creatorNotes: text('creator_notes'),
  headVersionId: text('head_version_id'),
  visibility: text('visibility', { enum: ['public', 'nsfw_only', 'unlisted', 'blocked'] }).default('public'),
  moderationState: text('moderation_state', { enum: ['ok', 'review', 'blocked'] }).default('ok'),
  upvotes: integer('upvotes').default(0),
  downvotes: integer('downvotes').default(0),
  favoritesCount: integer('favorites_count').default(0),
  downloadsCount: integer('downloads_count').default(0),
  commentsCount: integer('comments_count').default(0),
  forksCount: integer('forks_count').default(0),
  uploaderId: text('uploader_id').references(() => users.id),
  createdAt: integer('created_at').default(0),
  updatedAt: integer('updated_at').default(0),
}, (table) => [
  index('idx_cards_created_at').on(table.createdAt),
  index('idx_cards_downloads').on(table.downloadsCount),
  index('idx_cards_upvotes').on(table.upvotes),
  index('idx_cards_slug').on(table.slug),
  index('idx_cards_uploader').on(table.uploaderId),
  index('idx_cards_visibility').on(table.visibility),
  index('idx_cards_head_version').on(table.headVersionId),
]);

// Card Versions
export const cardVersions = sqliteTable('card_versions', {
  id: text('id').primaryKey(),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  parentVersionId: text('parent_version_id'),
  forkedFromId: text('forked_from_id'),
  storageUrl: text('storage_url').notNull(),
  contentHash: text('content_hash').notNull(),
  specVersion: text('spec_version').notNull(),
  sourceFormat: text('source_format').notNull().default('png'),
  tokensDescription: integer('tokens_description').default(0),
  tokensPersonality: integer('tokens_personality').default(0),
  tokensScenario: integer('tokens_scenario').default(0),
  tokensMesExample: integer('tokens_mes_example').default(0),
  tokensFirstMes: integer('tokens_first_mes').default(0),
  tokensSystemPrompt: integer('tokens_system_prompt').default(0),
  tokensPostHistory: integer('tokens_post_history').default(0),
  tokensTotal: integer('tokens_total').default(0),
  hasAltGreetings: integer('has_alt_greetings').default(0),
  altGreetingsCount: integer('alt_greetings_count').default(0),
  hasLorebook: integer('has_lorebook').default(0),
  lorebookEntriesCount: integer('lorebook_entries_count').default(0),
  hasEmbeddedImages: integer('has_embedded_images').default(0),
  embeddedImagesCount: integer('embedded_images_count').default(0),
  hasAssets: integer('has_assets').default(0),
  assetsCount: integer('assets_count').default(0),
  savedAssets: text('saved_assets'),
  imagePath: text('image_path'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  thumbnailPath: text('thumbnail_path'),
  thumbnailWidth: integer('thumbnail_width'),
  thumbnailHeight: integer('thumbnail_height'),
  cardData: text('card_data').notNull(),
  createdAt: integer('created_at').default(0),
}, (table) => [
  index('idx_versions_card').on(table.cardId),
  index('idx_versions_hash').on(table.contentHash),
  index('idx_versions_forked').on(table.forkedFromId),
  index('idx_versions_parent').on(table.parentVersionId),
]);

// Reports
export const reports = sqliteTable('reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
  reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status', { enum: ['pending', 'reviewed', 'dismissed', 'actioned'] }).default('pending'),
  createdAt: integer('created_at').default(0),
}, (table) => [
  index('idx_reports_status').on(table.status),
  index('idx_reports_card').on(table.cardId),
]);

// Tags
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  slug: text('slug').unique().notNull(),
  category: text('category'),
  usageCount: integer('usage_count').default(0),
}, (table) => [
  index('idx_tags_category').on(table.category),
]);

// Card Tags (junction table)
export const cardTags = sqliteTable('card_tags', {
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.cardId, table.tagId] }),
  index('idx_card_tags_card').on(table.cardId),
  index('idx_card_tags_tag').on(table.tagId),
]);

// Votes
export const votes = sqliteTable('votes', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  vote: integer('vote').notNull(),
  createdAt: integer('created_at').default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.cardId] }),
  index('idx_votes_card').on(table.cardId),
]);

// Favorites
export const favorites = sqliteTable('favorites', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.cardId] }),
  index('idx_favorites_user').on(table.userId),
  index('idx_favorites_card').on(table.cardId),
]);

// Downloads
export const downloads = sqliteTable('downloads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  format: text('format').notNull(),
  ipHash: text('ip_hash'),
  createdAt: integer('created_at').default(0),
}, (table) => [
  index('idx_downloads_card').on(table.cardId),
]);

// Comments
export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  content: text('content').notNull(),
  createdAt: integer('created_at').default(0),
  updatedAt: integer('updated_at').default(0),
}, (table) => [
  index('idx_comments_card').on(table.cardId),
]);

// Sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').default(0),
}, (table) => [
  index('idx_sessions_user').on(table.userId),
]);

// v1.1: Tag Preferences (follow/block tags per user)
export const tagPreferences = sqliteTable('tag_preferences', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  preference: text('preference', { enum: ['follow', 'block'] }).notNull(),
  createdAt: integer('created_at').default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.tagId] }),
  index('idx_tag_prefs_user').on(table.userId),
  index('idx_tag_prefs_tag').on(table.tagId),
  index('idx_tag_prefs_preference').on(table.preference),
]);

// v1.1: User Follows (social following system)
export const userFollows = sqliteTable('user_follows', {
  followerId: text('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  followingId: text('following_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').default(0),
}, (table) => [
  primaryKey({ columns: [table.followerId, table.followingId] }),
  index('idx_follows_follower').on(table.followerId),
  index('idx_follows_following').on(table.followingId),
]);

// Type exports for inference
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type CardVersion = typeof cardVersions.$inferSelect;
export type NewCardVersion = typeof cardVersions.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type TagPreference = typeof tagPreferences.$inferSelect;
export type NewTagPreference = typeof tagPreferences.$inferInsert;
export type UserFollow = typeof userFollows.$inferSelect;
export type NewUserFollow = typeof userFollows.$inferInsert;
