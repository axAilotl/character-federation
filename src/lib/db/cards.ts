import { type CardRow, type CardVersionRow, type CardWithVersionRow, type TagRow } from './index';
import { getDatabase, type AsyncDb } from './async-db';
import type { CardListItem, CardDetail, CardFilters, PaginatedResponse } from '@/types/card';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';

// Get async database instance (handles both local and Cloudflare)
const getDb = getDatabase;

// FTS functions - only work locally, no-op on Cloudflare
async function updateFtsIndexAsync(cardId: string, name: string, description: string | null, creator: string | null, creatorNotes: string | null): Promise<void> {
  try {
    const { updateFtsIndex, isCloudflareRuntime } = await import('./index');
    if (!isCloudflareRuntime()) {
      updateFtsIndex(cardId, name, description, creator, creatorNotes);
    }
  } catch {
    // FTS not available
  }
}

async function removeFtsIndexAsync(cardId: string): Promise<void> {
  try {
    const { removeFtsIndex, isCloudflareRuntime } = await import('./index');
    if (!isCloudflareRuntime()) {
      removeFtsIndex(cardId);
    }
  } catch {
    // FTS not available
  }
}

/**
 * Get paginated list of cards with filtering
 * @param filters - Filtering and pagination options
 * @param userId - Optional user ID to include isFavorited status for each card
 */
export async function getCards(filters: CardFilters = {}, userId?: string): Promise<PaginatedResponse<CardListItem>> {
  const db = await getDb();
  const {
    search,
    tags,
    excludeTags,
    sort = 'newest',
    page = 1,
    limit = 24,
    minTokens,
    maxTokens,
    hasAltGreetings,
    hasLorebook,
    hasEmbeddedImages,
    visibility = ['public'],
    includeNsfw = false,
  } = filters;

  const offset = (page - 1) * limit;
  const params: (string | number)[] = [];
  const conditions: string[] = [];

  // Visibility filter
  const allowedVisibility = includeNsfw ? ['public', 'nsfw_only'] : visibility;
  if (allowedVisibility.length > 0) {
    const visPlaceholders = allowedVisibility.map(() => '?').join(', ');
    conditions.push(`c.visibility IN (${visPlaceholders})`);
    params.push(...allowedVisibility);
  }

  conditions.push(`c.moderation_state != 'blocked'`);

  // Search condition
  let useFts = false;
  if (search && search.trim()) {
    const searchTerm = search.trim();
    if (searchTerm.length >= 2) {
      useFts = true;
      const ftsQuery = searchTerm
        .replace(/[\"\']/g, '')
        .split(/\s+/)
        .filter(word => word.length >= 2)
        .map(word => `"${word}"*`)
        .join(' ');

      if (ftsQuery) {
        conditions.push(`c.id IN (SELECT card_id FROM cards_fts WHERE cards_fts MATCH ?)`);
        params.push(ftsQuery);
      } else {
        useFts = false;
      }
    }

    if (!useFts) {
      conditions.push('(c.name LIKE ? OR c.description LIKE ? OR c.creator LIKE ?)');
      const likeTerm = `%${searchTerm}%`;
      params.push(likeTerm, likeTerm, likeTerm);
    }
  }

  // Tags filter
  if (tags && tags.length > 0) {
    const tagPlaceholders = tags.map(() => '?').join(', ');
    conditions.push(`c.id IN (
      SELECT ct.card_id FROM card_tags ct
      JOIN tags t ON ct.tag_id = t.id
      WHERE t.slug IN (${tagPlaceholders})
      GROUP BY ct.card_id
      HAVING COUNT(DISTINCT t.slug) = ?
    )`);
    params.push(...tags, tags.length);
  }

  // Exclude tags filter
  if (excludeTags && excludeTags.length > 0) {
    const excludeTagPlaceholders = excludeTags.map(() => '?').join(', ');
    conditions.push(`c.id NOT IN (
      SELECT ct.card_id FROM card_tags ct
      JOIN tags t ON ct.tag_id = t.id
      WHERE t.slug IN (${excludeTagPlaceholders})
    )`);
    params.push(...excludeTags);
  }

  // Token filters
  if (minTokens !== undefined && minTokens > 0) {
    conditions.push('v.tokens_total >= ?');
    params.push(minTokens);
  }
  if (maxTokens !== undefined && maxTokens > 0) {
    conditions.push('v.tokens_total <= ?');
    params.push(maxTokens);
  }

  // Feature filters
  if (hasAltGreetings) conditions.push('v.has_alt_greetings = 1');
  if (hasLorebook) conditions.push('v.has_lorebook = 1');
  if (hasEmbeddedImages) conditions.push('v.has_embedded_images = 1');

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort order
  let orderBy: string;
  switch (sort) {
    case 'oldest': orderBy = 'c.created_at ASC'; break;
    case 'popular': orderBy = '(c.upvotes - c.downvotes) DESC, c.created_at DESC'; break;
    case 'trending': orderBy = '((c.upvotes - c.downvotes) + (c.downloads_count / 10) + (c.favorites_count / 5)) * (1.0 / (1 + ((unixepoch() - c.created_at) / 86400))) DESC'; break;
    case 'downloads': orderBy = 'c.downloads_count DESC, c.created_at DESC'; break;
    case 'favorites': orderBy = 'c.favorites_count DESC, c.created_at DESC'; break;
    case 'newest':
    default: orderBy = 'c.created_at DESC';
  }

  // Count total
  const countQuery = `SELECT COUNT(*) as total FROM cards c LEFT JOIN card_versions v ON c.head_version_id = v.id ${whereClause}`;
  const totalResult = await db.prepare(countQuery).get<{ total: number }>(...params);
  const total = totalResult?.total || 0;

  // Get cards
  const query = `
    SELECT c.id, c.slug, c.name, c.description, c.creator, c.creator_notes,
      c.visibility, c.moderation_state, c.upvotes, c.downvotes, c.favorites_count,
      c.downloads_count, c.comments_count, c.forks_count, c.uploader_id, c.created_at, c.updated_at,
      v.id as version_id, v.spec_version, v.source_format, v.storage_url,
      v.has_assets, v.assets_count, v.image_path, v.thumbnail_path, v.tokens_total,
      v.has_alt_greetings, v.alt_greetings_count, v.has_lorebook, v.lorebook_entries_count,
      v.has_embedded_images, v.embedded_images_count,
      u.username as uploader_username, u.display_name as uploader_display_name
    FROM cards c
    LEFT JOIN card_versions v ON c.head_version_id = v.id
    LEFT JOIN users u ON c.uploader_id = u.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);
  const rows = await db.prepare(query).all<CardWithVersionRow & { uploader_username?: string; uploader_display_name?: string }>(...params);

  // Get tags
  const cardIds = rows.map(r => r.id);
  const tagsMap = await getTagsForCards(cardIds);

  // Get favorites for authenticated user
  const favoritesSet = userId ? await getFavoritesForCards(cardIds, userId) : new Set<string>();

  const items: CardListItem[] = rows.map(row => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    creator: row.creator,
    creatorNotes: row.creator_notes,
    specVersion: row.spec_version,
    sourceFormat: (row.source_format || 'png') as CardListItem['sourceFormat'],
    hasAssets: row.has_assets === 1,
    assetsCount: row.assets_count || 0,
    imagePath: row.image_path,
    thumbnailPath: row.thumbnail_path,
    tokensTotal: row.tokens_total,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.upvotes - row.downvotes,
    favoritesCount: row.favorites_count,
    downloadsCount: row.downloads_count,
    commentsCount: row.comments_count,
    forksCount: row.forks_count,
    hasAlternateGreetings: row.has_alt_greetings === 1,
    alternateGreetingsCount: row.alt_greetings_count,
    totalGreetingsCount: row.alt_greetings_count + 1,
    hasLorebook: row.has_lorebook === 1,
    lorebookEntriesCount: row.lorebook_entries_count,
    hasEmbeddedImages: row.has_embedded_images === 1,
    embeddedImagesCount: row.embedded_images_count,
    visibility: row.visibility,
    tags: tagsMap.get(row.id) || [],
    uploader: row.uploader_id ? {
      id: row.uploader_id,
      username: row.uploader_username || '',
      displayName: row.uploader_display_name || null,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // User-specific: only set if userId was provided
    ...(userId && { isFavorited: favoritesSet.has(row.id) }),
  }));

  return { items, total, page, limit, hasMore: offset + items.length < total };
}

/**
 * Get a single card by slug
 */
export async function getCardBySlug(slug: string): Promise<CardDetail | null> {
  const db = await getDb();

  const query = `
    SELECT c.*, v.id as version_id, v.storage_url, v.content_hash, v.spec_version, v.source_format,
      v.tokens_description, v.tokens_personality, v.tokens_scenario, v.tokens_mes_example,
      v.tokens_first_mes, v.tokens_system_prompt, v.tokens_post_history, v.tokens_total,
      v.has_alt_greetings, v.alt_greetings_count, v.has_lorebook, v.lorebook_entries_count,
      v.has_embedded_images, v.embedded_images_count, v.has_assets, v.assets_count, v.saved_assets,
      v.image_path, v.image_width, v.image_height, v.thumbnail_path, v.thumbnail_width, v.thumbnail_height,
      v.card_data, v.forked_from_id as forked_from_version_id, v.created_at as version_created_at,
      u.username as uploader_username, u.display_name as uploader_display_name
    FROM cards c
    LEFT JOIN card_versions v ON c.head_version_id = v.id
    LEFT JOIN users u ON c.uploader_id = u.id
    WHERE c.slug = ?
  `;

  const row = await db.prepare(query).get<CardWithVersionRow & { uploader_username?: string; uploader_display_name?: string }>(slug);
  if (!row) return null;

  const tagsMap = await getTagsForCards([row.id]);
  const tags = tagsMap.get(row.id) || [];
  const cardData = row.card_data ? JSON.parse(row.card_data) : {};
  const savedAssets = row.saved_assets ? JSON.parse(row.saved_assets) : null;

  // Get fork source
  let forkedFrom = null;
  if (row.forked_from_version_id) {
    const forkSource = await db.prepare(`
      SELECT c.id, c.slug, c.name, cv.id as version_id
      FROM card_versions cv JOIN cards c ON cv.card_id = c.id
      WHERE cv.id = ?
    `).get<{ id: string; slug: string; name: string; version_id: string }>(row.forked_from_version_id);

    if (forkSource) {
      forkedFrom = { id: forkSource.id, slug: forkSource.slug, name: forkSource.name, versionId: forkSource.version_id };
    }
  }

  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description,
    creator: row.creator, creatorNotes: row.creator_notes,
    specVersion: row.spec_version, sourceFormat: (row.source_format || 'png') as CardDetail['sourceFormat'],
    hasAssets: row.has_assets === 1, assetsCount: row.assets_count || 0,
    imagePath: row.image_path, thumbnailPath: row.thumbnail_path, tokensTotal: row.tokens_total,
    upvotes: row.upvotes, downvotes: row.downvotes, score: row.upvotes - row.downvotes,
    favoritesCount: row.favorites_count, downloadsCount: row.downloads_count,
    commentsCount: row.comments_count, forksCount: row.forks_count,
    hasAlternateGreetings: row.has_alt_greetings === 1, alternateGreetingsCount: row.alt_greetings_count,
    totalGreetingsCount: row.alt_greetings_count + 1,
    hasLorebook: row.has_lorebook === 1, lorebookEntriesCount: row.lorebook_entries_count,
    hasEmbeddedImages: row.has_embedded_images === 1, embeddedImagesCount: row.embedded_images_count,
    visibility: row.visibility, tags,
    uploader: row.uploader_id ? { id: row.uploader_id, username: row.uploader_username || '', displayName: row.uploader_display_name || null } : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
    tokens: {
      description: row.tokens_description, personality: row.tokens_personality, scenario: row.tokens_scenario,
      mesExample: row.tokens_mes_example, firstMes: row.tokens_first_mes, systemPrompt: row.tokens_system_prompt,
      postHistory: row.tokens_post_history, total: row.tokens_total,
    },
    cardData, savedAssets, forkedFrom,
    imageWidth: row.image_width, imageHeight: row.image_height,
    versionId: row.version_id, storageUrl: row.storage_url, contentHash: row.content_hash,
  };
}

/**
 * Get tags for a list of card IDs
 */
async function getTagsForCards(cardIds: string[]): Promise<Map<string, { id: number; name: string; slug: string; category: string | null }[]>> {
  if (cardIds.length === 0) return new Map();

  const db = await getDb();
  const placeholders = cardIds.map(() => '?').join(', ');

  const rows = await db.prepare(`
    SELECT ct.card_id, t.id, t.name, t.slug, t.category
    FROM card_tags ct JOIN tags t ON ct.tag_id = t.id
    WHERE ct.card_id IN (${placeholders})
  `).all<{ card_id: string; id: number; name: string; slug: string; category: string | null }>(...cardIds);

  const result = new Map<string, { id: number; name: string; slug: string; category: string | null }[]>();
  for (const row of rows) {
    if (!result.has(row.card_id)) result.set(row.card_id, []);
    result.get(row.card_id)!.push({ id: row.id, name: row.name, slug: row.slug, category: row.category });
  }
  return result;
}

/**
 * Get favorites for a list of card IDs for a specific user
 * Returns a Set of card IDs that the user has favorited
 */
async function getFavoritesForCards(cardIds: string[], userId: string): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();

  const db = await getDb();
  const placeholders = cardIds.map(() => '?').join(', ');

  const rows = await db.prepare(`
    SELECT card_id FROM favorites
    WHERE user_id = ? AND card_id IN (${placeholders})
  `).all<{ card_id: string }>(userId, ...cardIds);

  return new Set(rows.map(r => r.card_id));
}

/**
 * Get all tags grouped by category
 */
export async function getAllTags(): Promise<{ category: string; tags: TagRow[] }[]> {
  const db = await getDb();
  const rows = await db.prepare(`SELECT id, name, slug, category, usage_count FROM tags ORDER BY category, usage_count DESC, name`).all<TagRow>();

  const grouped = new Map<string, TagRow[]>();
  for (const row of rows) {
    const category = row.category || 'other';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(row);
  }

  return Array.from(grouped.entries()).map(([category, tags]) => ({ category, tags }));
}

/**
 * Input for creating a new card with its initial version
 */
export interface CreateCardInput {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator: string | null;
  creatorNotes: string | null;
  uploaderId: string | null;
  visibility?: 'public' | 'private' | 'nsfw_only' | 'unlisted';
  tagSlugs: string[];
  version: {
    storageUrl: string;
    contentHash: string;
    specVersion: string;
    sourceFormat: string;
    tokens: { description: number; personality: number; scenario: number; mesExample: number; firstMes: number; systemPrompt: number; postHistory: number; total: number };
    hasAltGreetings: boolean;
    altGreetingsCount: number;
    hasLorebook: boolean;
    lorebookEntriesCount: number;
    hasEmbeddedImages: boolean;
    embeddedImagesCount: number;
    hasAssets: boolean;
    assetsCount: number;
    savedAssets: string | null;
    imagePath: string | null;
    imageWidth: number | null;
    imageHeight: number | null;
    thumbnailPath: string | null;
    thumbnailWidth: number | null;
    thumbnailHeight: number | null;
    cardData: string;
    forkedFromVersionId?: string | null;
  };
}

/**
 * Get all blocked tags (slugs)
 * Returns a Set for O(1) lookups
 */
export async function getBlockedTags(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.prepare(`
    SELECT slug FROM tags WHERE is_blocked = 1
  `).all<{ slug: string }>();
  return new Set(rows.map(r => r.slug));
}

/**
 * Check if any of the given tag slugs are blocked
 * Returns the list of blocked tags if any are found, or empty array if none
 */
export async function checkBlockedTags(tagSlugs: string[]): Promise<string[]> {
  if (tagSlugs.length === 0) return [];

  const db = await getDb();
  const placeholders = tagSlugs.map(() => '?').join(', ');
  const rows = await db.prepare(`
    SELECT name, slug FROM tags
    WHERE slug IN (${placeholders}) AND is_blocked = 1
  `).all<{ name: string; slug: string }>(...tagSlugs);

  return rows.map(r => r.name);
}

/**
 * Create a new card with its initial version
 */
export async function createCard(input: CreateCardInput): Promise<{ cardId: string; versionId: string }> {
  const db = await getDb();
  const versionId = nanoid();

  const statements: { sql: string; params: unknown[] }[] = [];

  // Insert card identity
  statements.push({
    sql: `
      INSERT INTO cards (
        id, slug, name, description, creator, creator_notes,
        head_version_id, visibility, uploader_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.id,
      input.slug,
      input.name,
      input.description,
      input.creator,
      input.creatorNotes,
      versionId, // Set head to this version
      input.visibility || 'public',
      input.uploaderId
    ]
  });

  // Insert initial version
  statements.push({
    sql: `
      INSERT INTO card_versions (
        id, card_id, storage_url, content_hash, spec_version, source_format,
        tokens_description, tokens_personality, tokens_scenario,
        tokens_mes_example, tokens_first_mes, tokens_system_prompt,
        tokens_post_history, tokens_total,
        has_alt_greetings, alt_greetings_count,
        has_lorebook, lorebook_entries_count,
        has_embedded_images, embedded_images_count,
        has_assets, assets_count, saved_assets,
        image_path, image_width, image_height,
        thumbnail_path, thumbnail_width, thumbnail_height,
        card_data, forked_from_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `,
    params: [
      versionId,
      input.id,
      input.version.storageUrl,
      input.version.contentHash,
      input.version.specVersion,
      input.version.sourceFormat,
      input.version.tokens.description,
      input.version.tokens.personality,
      input.version.tokens.scenario,
      input.version.tokens.mesExample,
      input.version.tokens.firstMes,
      input.version.tokens.systemPrompt,
      input.version.tokens.postHistory,
      input.version.tokens.total,
      input.version.hasAltGreetings ? 1 : 0,
      input.version.altGreetingsCount,
      input.version.hasLorebook ? 1 : 0,
      input.version.lorebookEntriesCount,
      input.version.hasEmbeddedImages ? 1 : 0,
      input.version.embeddedImagesCount,
      input.version.hasAssets ? 1 : 0,
      input.version.assetsCount,
      input.version.savedAssets,
      input.version.imagePath,
      input.version.imageWidth,
      input.version.imageHeight,
      input.version.thumbnailPath,
      input.version.thumbnailWidth,
      input.version.thumbnailHeight,
      input.version.cardData,
      input.version.forkedFromVersionId || null
    ]
  });

  // If this is a fork, increment the source card's fork count
  if (input.version.forkedFromVersionId) {
    statements.push({
      sql: `
        UPDATE cards SET forks_count = forks_count + 1
        WHERE id = (SELECT card_id FROM card_versions WHERE id = ?)
      `,
      params: [input.version.forkedFromVersionId]
    });
  }

  // Execute the main batch
  await db.batch(statements);

  // Link tags - This logic is complex (Find-or-Create) and cannot be easily batched with the INSERTs above 
  // because we need the Tag IDs. 
  // However, we can optimize it.
  // For now, we keep it separate but use parallel execution where possible or a separate batch if we resolve IDs first.
  // Since SQLite/D1 doesn't support "INSERT ... RETURNING" in batch reliably across drivers, 
  // we stick to the Find-then-Insert pattern for tags, but we can batch the final link insertions.
  
  if (input.tagSlugs.length > 0) {
    for (const tag of input.tagSlugs) {
      const slug = tag.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!slug) continue;

      // Find or create tag (unfortunately needs read-then-write, hard to batch purely)
      let tagRow = await db.prepare('SELECT id FROM tags WHERE slug = ?').get<{ id: number }>(slug);
      if (!tagRow) {
        await db.prepare('INSERT INTO tags (name, slug, category, usage_count) VALUES (?, ?, ?, 0)').run(tag.trim(), slug, null);
        tagRow = await db.prepare('SELECT id FROM tags WHERE slug = ?').get<{ id: number }>(slug);
      }

      if (tagRow) {
        // We can batch these if we wanted, but mixed with read-logic it's hard.
        // We'll optimize by just running them.
        await db.prepare('INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?, ?)').run(input.id, tagRow.id);
        await db.prepare('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?').run(tagRow.id);
      }
    }
  }

  // Update FTS index (outside transaction for better error handling)
  await updateFtsIndexAsync(input.id, input.name, input.description, input.creator, input.creatorNotes);

  return { cardId: input.id, versionId };
}

/**
 * Create a new version for an existing card
 */
export interface CreateVersionInput {
  cardId: string;
  storageUrl: string;
  contentHash: string;
  specVersion: string;
  sourceFormat: string;
  tokens: { description: number; personality: number; scenario: number; mesExample: number; firstMes: number; systemPrompt: number; postHistory: number; total: number };
  hasAltGreetings: boolean;
  altGreetingsCount: number;
  hasLorebook: boolean;
  lorebookEntriesCount: number;
  hasEmbeddedImages: boolean;
  embeddedImagesCount: number;
  hasAssets: boolean;
  assetsCount: number;
  savedAssets: string | null;
  imagePath: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  thumbnailPath: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  cardData: string;
}

export async function createVersion(input: CreateVersionInput): Promise<string> {
  const db = await getDb();
  const versionId = nanoid();

  await db.transaction(async () => {
    const card = await db.prepare('SELECT head_version_id FROM cards WHERE id = ?').get<{ head_version_id: string | null }>(input.cardId);
    const parentVersionId = card?.head_version_id || null;

    await db.prepare(`
      INSERT INTO card_versions (
        id, card_id, parent_version_id, storage_url, content_hash, spec_version, source_format,
        tokens_description, tokens_personality, tokens_scenario, tokens_mes_example, tokens_first_mes, tokens_system_prompt, tokens_post_history, tokens_total,
        has_alt_greetings, alt_greetings_count, has_lorebook, lorebook_entries_count, has_embedded_images, embedded_images_count,
        has_assets, assets_count, saved_assets, image_path, image_width, image_height, thumbnail_path, thumbnail_width, thumbnail_height, card_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId, input.cardId, parentVersionId, input.storageUrl, input.contentHash, input.specVersion, input.sourceFormat,
      input.tokens.description, input.tokens.personality, input.tokens.scenario, input.tokens.mesExample, input.tokens.firstMes, input.tokens.systemPrompt, input.tokens.postHistory, input.tokens.total,
      input.hasAltGreetings ? 1 : 0, input.altGreetingsCount, input.hasLorebook ? 1 : 0, input.lorebookEntriesCount, input.hasEmbeddedImages ? 1 : 0, input.embeddedImagesCount,
      input.hasAssets ? 1 : 0, input.assetsCount, input.savedAssets, input.imagePath, input.imageWidth, input.imageHeight, input.thumbnailPath, input.thumbnailWidth, input.thumbnailHeight, input.cardData
    );

    await db.prepare('UPDATE cards SET head_version_id = ?, updated_at = unixepoch() WHERE id = ?').run(versionId, input.cardId);
  });

  return versionId;
}

/**
 * Get version history for a card
 */
export async function getCardVersions(cardId: string): Promise<CardVersionRow[]> {
  const db = await getDb();
  return db.prepare(`SELECT * FROM card_versions WHERE card_id = ? ORDER BY created_at DESC`).all<CardVersionRow>(cardId);
}

/**
 * Get a single card version by ID
 */
export async function getCardVersionById(versionId: string): Promise<CardVersionRow | null> {
  const db = await getDb();
  const row = await db.prepare('SELECT * FROM card_versions WHERE id = ?').get<CardVersionRow>(versionId);
  return row || null;
}

/**
 * Increment download count
 */
export async function incrementDownloads(cardId: string): Promise<void> {
  const db = await getDb();
  await db.prepare('UPDATE cards SET downloads_count = downloads_count + 1 WHERE id = ?').run(cardId);
}

/**
 * Get all valid tag slugs
 */
export async function getValidTagSlugs(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.prepare('SELECT slug FROM tags').all<{ slug: string }>();
  return new Set(rows.map(r => r.slug));
}

/**
 * Delete a card and its associated data
 */
export async function deleteCard(cardId: string): Promise<void> {
  const db = await getDb();

  await removeFtsIndexAsync(cardId);

  // Prepare batch statements
  const statements: { sql: string; params: unknown[] }[] = [];

  // Get tags to decrement usage counts
  // This read is necessary to know WHICH tags to decrement.
  // We can't batch the read with the writes in one go, but we can batch all the writes.
  const tagSlugs = await db.prepare(`SELECT t.slug FROM card_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.card_id = ?`).all<{ slug: string }>(cardId);
  
  for (const { slug } of tagSlugs) {
    statements.push({
      sql: 'UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE slug = ?',
      params: [slug]
    });
  }

  statements.push({ sql: 'DELETE FROM card_tags WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM votes WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM favorites WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM downloads WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM comments WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM reports WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM card_versions WHERE card_id = ?', params: [cardId] });
  statements.push({ sql: 'DELETE FROM cards WHERE id = ?', params: [cardId] });

  await db.batch(statements);
}

/**
 * Vote on a card
 */
export async function voteOnCard(userId: string, cardId: string, vote: 1 | -1): Promise<void> {
  const db = await getDb();

  await db.transaction(async () => {
    const existing = await db.prepare('SELECT vote FROM votes WHERE user_id = ? AND card_id = ?').get<{ vote: number }>(userId, cardId);

    if (existing) {
      if (existing.vote === vote) {
        await db.prepare('DELETE FROM votes WHERE user_id = ? AND card_id = ?').run(userId, cardId);
        if (vote === 1) await db.prepare('UPDATE cards SET upvotes = upvotes - 1 WHERE id = ?').run(cardId);
        else await db.prepare('UPDATE cards SET downvotes = downvotes - 1 WHERE id = ?').run(cardId);
      } else {
        await db.prepare('UPDATE votes SET vote = ?, created_at = unixepoch() WHERE user_id = ? AND card_id = ?').run(vote, userId, cardId);
        if (vote === 1) await db.prepare('UPDATE cards SET upvotes = upvotes + 1, downvotes = downvotes - 1 WHERE id = ?').run(cardId);
        else await db.prepare('UPDATE cards SET upvotes = upvotes - 1, downvotes = downvotes + 1 WHERE id = ?').run(cardId);
      }
    } else {
      await db.prepare('INSERT INTO votes (user_id, card_id, vote) VALUES (?, ?, ?)').run(userId, cardId, vote);
      if (vote === 1) await db.prepare('UPDATE cards SET upvotes = upvotes + 1 WHERE id = ?').run(cardId);
      else await db.prepare('UPDATE cards SET downvotes = downvotes + 1 WHERE id = ?').run(cardId);
    }
  });
}

/**
 * Get user's vote on a card
 */
export async function getUserVote(userId: string, cardId: string): Promise<number | null> {
  const db = await getDb();
  const row = await db.prepare('SELECT vote FROM votes WHERE user_id = ? AND card_id = ?').get<{ vote: number }>(userId, cardId);
  return row?.vote || null;
}

/**
 * Toggle favorite on a card
 */
export async function toggleFavorite(userId: string, cardId: string): Promise<boolean> {
  const db = await getDb();
  let isFavorited = false;

  await db.transaction(async () => {
    const existing = await db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND card_id = ?').get(userId, cardId);

    if (existing) {
      await db.prepare('DELETE FROM favorites WHERE user_id = ? AND card_id = ?').run(userId, cardId);
      await db.prepare('UPDATE cards SET favorites_count = favorites_count - 1 WHERE id = ?').run(cardId);
      isFavorited = false;
    } else {
      await db.prepare('INSERT INTO favorites (user_id, card_id) VALUES (?, ?)').run(userId, cardId);
      await db.prepare('UPDATE cards SET favorites_count = favorites_count + 1 WHERE id = ?').run(cardId);
      isFavorited = true;
    }
  });

  return isFavorited;
}

/**
 * Check if user has favorited a card
 */
export async function isFavorited(userId: string, cardId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND card_id = ?').get(userId, cardId);
  return !!row;
}

/**
 * Get user's favorites
 */
export async function getUserFavorites(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.prepare('SELECT card_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC').all<{ card_id: string }>(userId);
  return rows.map(r => r.card_id);
}

/**
 * Add a comment to a card
 */
export async function addComment(cardId: string, userId: string, content: string, parentId?: string): Promise<string> {
  const db = await getDb();
  const commentId = nanoid();

  await db.transaction(async () => {
    await db.prepare('INSERT INTO comments (id, card_id, user_id, parent_id, content) VALUES (?, ?, ?, ?, ?)').run(commentId, cardId, userId, parentId || null, content);
    await db.prepare('UPDATE cards SET comments_count = comments_count + 1 WHERE id = ?').run(cardId);
  });

  return commentId;
}

/**
 * Get comments for a card
 */
export async function getComments(cardId: string): Promise<{ id: string; userId: string; username: string; displayName: string | null; parentId: string | null; content: string; createdAt: number }[]> {
  const db = await getDb();
  const rows = await db.prepare(`
    SELECT c.id, c.user_id, c.parent_id, c.content, c.created_at, u.username, u.display_name
    FROM comments c JOIN users u ON c.user_id = u.id WHERE c.card_id = ? ORDER BY c.created_at ASC
  `).all<{ id: string; user_id: string; parent_id: string | null; content: string; created_at: number; username: string; display_name: string | null }>(cardId);

  return rows.map(r => ({ id: r.id, userId: r.user_id, username: r.username, displayName: r.display_name, parentId: r.parent_id, content: r.content, createdAt: r.created_at }));
}

/**
 * Report a card
 */
export async function reportCard(cardId: string, reporterId: string, reason: string, details?: string): Promise<void> {
  const db = await getDb();

  await db.transaction(async () => {
    await db.prepare('INSERT INTO reports (card_id, reporter_id, reason, details) VALUES (?, ?, ?, ?)').run(cardId, reporterId, reason, details || null);

    const reportCount = await db.prepare(`SELECT COUNT(*) as count FROM reports WHERE card_id = ? AND status = 'pending'`).get<{ count: number }>(cardId);
    if (reportCount && reportCount.count >= 3) {
      await db.prepare(`UPDATE cards SET moderation_state = 'review' WHERE id = ?`).run(cardId);
    }
  });
}

/**
 * Update card visibility (admin only)
 */
export async function updateCardVisibility(cardId: string, visibility: 'public' | 'private' | 'nsfw_only' | 'unlisted' | 'blocked'): Promise<void> {
  const db = await getDb();
  await db.prepare('UPDATE cards SET visibility = ?, updated_at = unixepoch() WHERE id = ?').run(visibility, cardId);
}

/**
 * Update card moderation state (admin only)
 */
export async function updateModerationState(cardId: string, state: 'ok' | 'review' | 'blocked'): Promise<void> {
  const db = await getDb();
  await db.prepare('UPDATE cards SET moderation_state = ?, updated_at = unixepoch() WHERE id = ?').run(state, cardId);
}

/**
 * Compute content hash for a buffer
 */
export function computeContentHash(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}
