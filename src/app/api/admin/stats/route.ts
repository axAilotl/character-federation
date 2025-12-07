import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics
 */
export async function GET() {
  try {
    // Check authentication and admin status
    const session = await getSession();
    if (!session || !session.user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const db = await getDatabase();

    // Total cards
    const totalCardsResult = await db.prepare('SELECT COUNT(*) as count FROM cards').get<{ count: number }>();
    const totalCards = totalCardsResult?.count || 0;

    // Total users
    const totalUsersResult = await db.prepare('SELECT COUNT(*) as count FROM users').get<{ count: number }>();
    const totalUsers = totalUsersResult?.count || 0;

    // Total downloads
    const totalDownloadsResult = await db.prepare('SELECT SUM(downloads_count) as total FROM cards').get<{ total: number | null }>();
    const totalDownloads = totalDownloadsResult?.total || 0;

    // Pending reports
    const pendingReportsResult = await db.prepare("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'").get<{ count: number }>();
    const pendingReports = pendingReportsResult?.count || 0;

    // Cards uploaded today
    const todayStart = Math.floor(Date.now() / 1000) - (new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds());
    const cardsTodayResult = await db.prepare('SELECT COUNT(*) as count FROM cards WHERE created_at >= ?').get<{ count: number }>(todayStart);
    const cardsToday = cardsTodayResult?.count || 0;

    // Cards by visibility
    const visibilityStats = await db.prepare(`
      SELECT
        visibility,
        COUNT(*) as count
      FROM cards
      GROUP BY visibility
    `).all<{ visibility: string; count: number }>();

    const cardsByVisibility = {
      public: 0,
      nsfw_only: 0,
      unlisted: 0,
      blocked: 0,
    };
    for (const row of visibilityStats) {
      if (row.visibility in cardsByVisibility) {
        cardsByVisibility[row.visibility as keyof typeof cardsByVisibility] = row.count;
      }
    }

    // Cards by moderation state
    const moderationStats = await db.prepare(`
      SELECT
        moderation_state,
        COUNT(*) as count
      FROM cards
      GROUP BY moderation_state
    `).all<{ moderation_state: string; count: number }>();

    const cardsByModeration = {
      ok: 0,
      review: 0,
      blocked: 0,
    };
    for (const row of moderationStats) {
      if (row.moderation_state in cardsByModeration) {
        cardsByModeration[row.moderation_state as keyof typeof cardsByModeration] = row.count;
      }
    }

    return NextResponse.json({
      totalCards,
      totalUsers,
      totalDownloads,
      pendingReports,
      cardsToday,
      cardsByVisibility,
      cardsByModeration,
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
