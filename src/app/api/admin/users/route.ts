import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { parseQuery, AdminUsersFilterSchema } from '@/lib/validations';

/**
 * GET /api/admin/users
 * Get paginated list of users for admin management
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
    const parsed = parseQuery(request.nextUrl.searchParams, AdminUsersFilterSchema);
    if ('error' in parsed) return parsed.error;
    const { page, limit, search } = parsed.data;

    const db = await getDatabase();
    const offset = (page - 1) * limit;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    // Search filter
    if (search) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM users u ${whereClause}`;
    const totalResult = await db.prepare(countQuery).get<{ total: number }>(...params);
    const total = totalResult?.total || 0;

    // Get users with card and comment counts
    const query = `
      SELECT
        u.id, u.username, u.display_name, u.email, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM cards c WHERE c.uploader_id = u.id) as cards_count,
        (SELECT COUNT(*) FROM comments cm WHERE cm.user_id = u.id) as comments_count
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const rows = await db.prepare(query).all<{
      id: string;
      username: string;
      display_name: string | null;
      email: string | null;
      is_admin: number;
      created_at: number;
      cards_count: number;
      comments_count: number;
    }>(...params);

    const items = rows.map(row => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      isAdmin: row.is_admin === 1,
      cardsCount: row.cards_count,
      commentsCount: row.comments_count,
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
