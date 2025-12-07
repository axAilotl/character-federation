import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { parseQuery, AdminCardsFilterSchema } from '@/lib/validations';

/**
 * GET /api/admin/cards
 * Get paginated list of cards for admin management
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication and admin status
    const session = await getSession();
    if (!session || !session.user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Parse and validate query parameters
    const parsed = parseQuery(request.nextUrl.searchParams, AdminCardsFilterSchema);
    if ('error' in parsed) return parsed.error;
    const { page, limit, search, visibility, moderation } = parsed.data;

    const db = await getDatabase();
    const offset = (page - 1) * limit;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    // Search filter
    if (search) {
      conditions.push('(c.name LIKE ? OR c.creator LIKE ? OR c.slug LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Visibility filter
    if (visibility && visibility !== 'all') {
      conditions.push('c.visibility = ?');
      params.push(visibility);
    }

    // Moderation filter
    if (moderation && moderation !== 'all') {
      conditions.push('c.moderation_state = ?');
      params.push(moderation);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM cards c ${whereClause}`;
    const totalResult = await db.prepare(countQuery).get<{ total: number }>(...params);
    const total = totalResult?.total || 0;

    // Get cards with report counts
    const query = `
      SELECT
        c.id, c.slug, c.name, c.creator,
        c.visibility, c.moderation_state,
        c.upvotes, c.downvotes, c.downloads_count,
        c.created_at, c.uploader_id,
        v.thumbnail_path,
        u.username as uploader_username,
        (SELECT COUNT(*) FROM reports r WHERE r.card_id = c.id AND r.status = 'pending') as reports_count
      FROM cards c
      LEFT JOIN card_versions v ON c.head_version_id = v.id
      LEFT JOIN users u ON c.uploader_id = u.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const rows = await db.prepare(query).all<{
      id: string;
      slug: string;
      name: string;
      creator: string | null;
      visibility: string;
      moderation_state: string;
      upvotes: number;
      downvotes: number;
      downloads_count: number;
      created_at: number;
      uploader_id: string | null;
      thumbnail_path: string | null;
      uploader_username: string | null;
      reports_count: number;
    }>(...params);

    const items = rows.map(row => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      creator: row.creator,
      visibility: row.visibility,
      moderationState: row.moderation_state,
      thumbnailPath: row.thumbnail_path,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      downloadsCount: row.downloads_count,
      reportsCount: row.reports_count,
      createdAt: row.created_at,
      uploader: row.uploader_id ? {
        id: row.uploader_id,
        username: row.uploader_username || 'Unknown',
      } : null,
    }));

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    console.error('Error fetching admin cards:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cards' },
      { status: 500 }
    );
  }
}
