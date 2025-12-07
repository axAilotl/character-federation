import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null; // v1.1
  profileCss: string | null; // v1.1
  isAdmin: boolean;
  createdAt: number;
  stats: {
    cardsCount: number;
    totalDownloads: number;
    totalUpvotes: number;
    favoritesCount: number;
  };
  // v1.1: Social stats
  followersCount: number;
  followingCount: number;
  isFollowing: boolean; // Whether current user follows this user
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
    const session = await getSession();

    const db = await getDatabase();

    // Get user profile and stats in a single query
    const result = await db.prepare(`
      SELECT
        u.id, u.username, u.display_name, u.avatar_url, u.bio, u.profile_css,
        u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM cards WHERE uploader_id = u.id) as cards_count,
        (SELECT COALESCE(SUM(downloads_count), 0) FROM cards WHERE uploader_id = u.id) as total_downloads,
        (SELECT COALESCE(SUM(upvotes - downvotes), 0) FROM cards WHERE uploader_id = u.id) as total_upvotes,
        (SELECT COUNT(*) FROM favorites WHERE user_id = u.id) as favorites_count,
        (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id) as followers_count,
        (SELECT COUNT(*) FROM user_follows WHERE follower_id = u.id) as following_count
      FROM users u
      WHERE u.username = ?
    `).get<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      profile_css: string | null;
      is_admin: number;
      created_at: number;
      cards_count: number;
      total_downloads: number;
      total_upvotes: number;
      favorites_count: number;
      followers_count: number;
      following_count: number;
    }>(username);

    if (!result) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if current user follows this user
    let isFollowing = false;
    if (session && session.user.id !== result.id) {
      const follow = await db.prepare(
        'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
      ).get(session.user.id, result.id);
      isFollowing = !!follow;
    }

    const profile: UserProfile = {
      id: result.id,
      username: result.username,
      displayName: result.display_name,
      avatarUrl: result.avatar_url,
      bio: result.bio,
      profileCss: result.profile_css,
      isAdmin: result.is_admin === 1,
      createdAt: result.created_at,
      stats: {
        cardsCount: result.cards_count,
        totalDownloads: result.total_downloads,
        totalUpvotes: result.total_upvotes,
        favoritesCount: result.favorites_count,
      },
      followersCount: result.followers_count,
      followingCount: result.following_count,
      isFollowing,
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