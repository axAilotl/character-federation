import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: number;
  stats: {
    cardsCount: number;
    totalDownloads: number;
    totalUpvotes: number;
    favoritesCount: number;
  };
}

/**
 * GET /api/users/[username]
 * Get public user profile
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;

    const db = getAsyncDb();

    // Get user profile and stats in a single query
    const result = await db.prepare(`
      SELECT 
        u.id, u.username, u.display_name, u.avatar_url, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM cards WHERE uploader_id = u.id) as cards_count,
        (SELECT COALESCE(SUM(downloads_count), 0) FROM cards WHERE uploader_id = u.id) as total_downloads,
        (SELECT COALESCE(SUM(upvotes - downvotes), 0) FROM cards WHERE uploader_id = u.id) as total_upvotes,
        (SELECT COUNT(*) FROM favorites WHERE user_id = u.id) as favorites_count
      FROM users u
      WHERE u.username = ?
    `).get<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      is_admin: number;
      created_at: number;
      cards_count: number;
      total_downloads: number;
      total_upvotes: number;
      favorites_count: number;
    }>(username);

    if (!result) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const profile: UserProfile = {
      id: result.id,
      username: result.username,
      displayName: result.display_name,
      avatarUrl: result.avatar_url,
      isAdmin: result.is_admin === 1,
      createdAt: result.created_at,
      stats: {
        cardsCount: result.cards_count,
        totalDownloads: result.total_downloads,
        totalUpvotes: result.total_upvotes,
        favoritesCount: result.favorites_count,
      },
    };

    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user profile' },
      { status: 500 }
    );
  }
}