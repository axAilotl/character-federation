import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';
import type { CardListItem } from '@/types/card';

/**
 * GET /api/users/[username]/favorites
 * Get cards favorited by a user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 100);

    const db = getAsyncDb();
    const offset = (page - 1) * limit;

    // Get user by username
    const user = await db.prepare('SELECT id FROM users WHERE username = ?').get<{ id: string }>(username);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Count total
    const totalResult = await db.prepare(`
      SELECT COUNT(*) as total
      FROM favorites f
      JOIN cards c ON f.card_id = c.id
      WHERE f.user_id = ?
        AND c.visibility IN ('public', 'nsfw_only')
        AND c.moderation_state != 'blocked'
    `).get<{ total: number }>(user.id);

    // Get favorited cards (ordered by when favorited)
    const query = `
      SELECT
        c.id, c.slug, c.name, c.description, c.creator, c.creator_notes,
        c.visibility, c.upvotes, c.downvotes, c.favorites_count,
        c.downloads_count, c.comments_count, c.forks_count,
        c.uploader_id, c.created_at, c.updated_at,
        v.spec_version, v.source_format, v.tokens_total,
        v.has_alt_greetings, v.alt_greetings_count,
        v.has_lorebook, v.lorebook_entries_count,
        v.has_embedded_images, v.embedded_images_count,
        v.has_assets, v.assets_count,
        v.image_path, v.thumbnail_path,
        u.username as uploader_username, u.display_name as uploader_display_name,
        f.created_at as favorited_at
      FROM favorites f
      JOIN cards c ON f.card_id = c.id
      LEFT JOIN card_versions v ON c.head_version_id = v.id
      LEFT JOIN users u ON c.uploader_id = u.id
      WHERE f.user_id = ?
        AND c.visibility IN ('public', 'nsfw_only')
        AND c.moderation_state != 'blocked'
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await db.prepare(query).all<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      creator: string | null;
      creator_notes: string | null;
      visibility: string;
      upvotes: number;
      downvotes: number;
      favorites_count: number;
      downloads_count: number;
      comments_count: number;
      forks_count: number;
      uploader_id: string | null;
      created_at: number;
      updated_at: number;
      spec_version: string;
      source_format: string;
      tokens_total: number;
      has_alt_greetings: number;
      alt_greetings_count: number;
      has_lorebook: number;
      lorebook_entries_count: number;
      has_embedded_images: number;
      embedded_images_count: number;
      has_assets: number;
      assets_count: number;
      image_path: string | null;
      thumbnail_path: string | null;
      uploader_username: string | null;
      uploader_display_name: string | null;
      favorited_at: number;
    }>(user.id, limit, offset);

    // Get tags for cards
    const cardIds = rows.map(r => r.id);
    const tagsMap = new Map<string, { id: number; name: string; slug: string; category: string | null }[]>();

    if (cardIds.length > 0) {
      const placeholders = cardIds.map(() => '?').join(', ');
      const tagRows = await db.prepare(`
        SELECT ct.card_id, t.id, t.name, t.slug, t.category
        FROM card_tags ct
        JOIN tags t ON ct.tag_id = t.id
        WHERE ct.card_id IN (${placeholders})
      `).all<{
        card_id: string;
        id: number;
        name: string;
        slug: string;
        category: string | null;
      }>(...cardIds);

      for (const row of tagRows) {
        if (!tagsMap.has(row.card_id)) {
          tagsMap.set(row.card_id, []);
        }
        tagsMap.get(row.card_id)!.push({
          id: row.id,
          name: row.name,
          slug: row.slug,
          category: row.category,
        });
      }
    }

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
      favoritesCount: row.favorites_count,
      downloadsCount: row.downloads_count,
      commentsCount: row.comments_count,
      forksCount: row.forks_count,
      hasAlternateGreetings: row.has_alt_greetings === 1,
      alternateGreetingsCount: row.alt_greetings_count,
      hasLorebook: row.has_lorebook === 1,
      lorebookEntriesCount: row.lorebook_entries_count,
      hasEmbeddedImages: row.has_embedded_images === 1,
      embeddedImagesCount: row.embedded_images_count,
      visibility: row.visibility as CardListItem['visibility'],
      tags: tagsMap.get(row.id) || [],
      uploader: row.uploader_id ? {
        id: row.uploader_id,
        username: row.uploader_username || '',
        displayName: row.uploader_display_name || null,
      } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({
      items,
      total: totalResult?.total || 0,
      page,
      limit,
      hasMore: offset + items.length < (totalResult?.total || 0),
    });
  } catch (error) {
    console.error('Error fetching user favorites:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user favorites' },
      { status: 500 }
    );
  }
}
