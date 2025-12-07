import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { parseQuery, AdminReportsFilterSchema } from '@/lib/validations';

/**
 * GET /api/admin/reports
 * Get paginated list of reports for admin management
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
    const parsed = parseQuery(request.nextUrl.searchParams, AdminReportsFilterSchema);
    if ('error' in parsed) return parsed.error;
    const { page, limit, status } = parsed.data;

    const db = await getDatabase();
    const offset = (page - 1) * limit;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    // Status filter
    if (status && status !== 'all') {
      conditions.push('r.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM reports r ${whereClause}`;
    const totalResult = await db.prepare(countQuery).get<{ total: number }>(...params);
    const total = totalResult?.total || 0;

    // Get reports with card and reporter info
    const query = `
      SELECT
        r.id, r.card_id, r.reporter_id, r.reason, r.details, r.status, r.created_at,
        c.slug as card_slug, c.name as card_name,
        v.thumbnail_path as card_thumbnail,
        u.username as reporter_username
      FROM reports r
      JOIN cards c ON r.card_id = c.id
      LEFT JOIN card_versions v ON c.head_version_id = v.id
      JOIN users u ON r.reporter_id = u.id
      ${whereClause}
      ORDER BY
        CASE r.status
          WHEN 'pending' THEN 0
          WHEN 'reviewed' THEN 1
          WHEN 'resolved' THEN 2
          WHEN 'dismissed' THEN 3
        END,
        r.created_at DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const rows = await db.prepare(query).all<{
      id: number;
      card_id: string;
      reporter_id: string;
      reason: string;
      details: string | null;
      status: string;
      created_at: number;
      card_slug: string;
      card_name: string;
      card_thumbnail: string | null;
      reporter_username: string;
    }>(...params);

    const items = rows.map(row => ({
      id: row.id,
      cardId: row.card_id,
      cardSlug: row.card_slug,
      cardName: row.card_name,
      cardThumbnail: row.card_thumbnail,
      reporterId: row.reporter_id,
      reporterUsername: row.reporter_username,
      reason: row.reason,
      details: row.details,
      status: row.status,
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
    console.error('Error fetching admin reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}
