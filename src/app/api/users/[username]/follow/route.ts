import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/users/[username]/follow
 * Check if current user follows the target user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ isFollowing: false });
    }

    const { username } = await params;
    const db = await getDatabase();

    // Get target user
    const targetUser = await db.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).get<{ id: string }>(username);

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if following
    const follow = await db.prepare(
      'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
    ).get(session.user.id, targetUser.id);

    return NextResponse.json({ isFollowing: !!follow });
  } catch (error) {
    console.error('Error checking follow status:', error);
    return NextResponse.json(
      { error: 'Failed to check follow status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users/[username]/follow
 * Follow the target user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { username } = await params;
    const db = await getDatabase();

    // Get target user
    const targetUser = await db.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).get<{ id: string }>(username);

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Cannot follow yourself
    if (targetUser.id === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot follow yourself' },
        { status: 400 }
      );
    }

    // Insert follow (ignore if already following)
    await db.prepare(`
      INSERT OR IGNORE INTO user_follows (follower_id, following_id, created_at)
      VALUES (?, ?, unixepoch())
    `).run(session.user.id, targetUser.id);

    // Get updated counts
    const counts = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) as followers_count,
        (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) as following_count
    `).get<{ followers_count: number; following_count: number }>(targetUser.id, targetUser.id);

    return NextResponse.json({
      success: true,
      isFollowing: true,
      followersCount: counts?.followers_count || 0,
      followingCount: counts?.following_count || 0,
    });
  } catch (error) {
    console.error('Error following user:', error);
    return NextResponse.json(
      { error: 'Failed to follow user' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/users/[username]/follow
 * Unfollow the target user
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { username } = await params;
    const db = await getDatabase();

    // Get target user
    const targetUser = await db.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).get<{ id: string }>(username);

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Delete follow
    await db.prepare(
      'DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?'
    ).run(session.user.id, targetUser.id);

    // Get updated counts
    const counts = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) as followers_count,
        (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) as following_count
    `).get<{ followers_count: number; following_count: number }>(targetUser.id, targetUser.id);

    return NextResponse.json({
      success: true,
      isFollowing: false,
      followersCount: counts?.followers_count || 0,
      followingCount: counts?.following_count || 0,
    });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    return NextResponse.json(
      { error: 'Failed to unfollow user' },
      { status: 500 }
    );
  }
}
