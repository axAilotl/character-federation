import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { sanitizeCss, validateNoUiBreaking } from '@/lib/security/css-sanitizer';

/**
 * Sanitize CSS using comprehensive security checks.
 * Returns sanitized CSS string or null if invalid.
 */
function sanitizeProfileCSS(css: string): string | null {
  // Use the shared sanitizer with profile-specific settings
  const sanitized = sanitizeCss(css, {
    scope: '[data-profile]',
    maxSelectors: 500,
    maxNestingDepth: 10,
    allowAnimations: true,
    allowMediaQueries: true,
  });

  if (!sanitized) return null;

  // Additional validation: no UI-breaking patterns
  const validation = validateNoUiBreaking(sanitized);
  if (!validation.valid) {
    console.warn('CSS validation failed:', validation.reason);
    return null;
  }

  return sanitized;
}

/**
 * GET /api/users/me
 * Get current user's profile
 */
export async function GET() {
  try {
    const session = await getSession();
    console.log('[/api/users/me GET] Session:', session ? `User ${session.user.id}` : 'None');

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const db = await getDatabase();
    console.log('[/api/users/me GET] Database connection acquired');

    const user = await db.prepare(`
      SELECT id, username, display_name, email, avatar_url, bio, profile_css, is_admin, created_at
      FROM users WHERE id = ?
    `).get<{
      id: string;
      username: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
      bio: string | null;
      profile_css: string | null;
      is_admin: number;
      created_at: number;
    }>(session.user.id);

    console.log('[/api/users/me GET] Query result:', user ? `Found user ${user.username}` : 'No user found');

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      profileCss: user.profile_css,
      isAdmin: user.is_admin === 1,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error('[/api/users/me GET] Error:', error);
    console.error('[/api/users/me GET] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      {
        error: 'Failed to fetch profile',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/users/me
 * Update current user's profile
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { displayName, email, bio, profileCss } = body;

    const db = await getDatabase();
    const updates: string[] = [];
    const params: (string | null)[] = [];

    // Validate and add display name
    if (displayName !== undefined) {
      if (displayName && displayName.length > 50) {
        return NextResponse.json(
          { error: 'Display name too long (max 50 characters)' },
          { status: 400 }
        );
      }
      updates.push('display_name = ?');
      params.push(displayName || null);
    }

    // Validate and add email
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: 'Invalid email address' },
          { status: 400 }
        );
      }

      // Check if email is already taken
      if (email) {
        const existing = await db.prepare(
          'SELECT id FROM users WHERE email = ? AND id != ?'
        ).get(email, session.user.id);
        if (existing) {
          return NextResponse.json(
            { error: 'Email already in use' },
            { status: 400 }
          );
        }
      }

      updates.push('email = ?');
      params.push(email || null);
    }

    // v1.1: Validate and add bio
    if (bio !== undefined) {
      if (bio && bio.length > 2000) {
        return NextResponse.json(
          { error: 'Bio too long (max 2000 characters)' },
          { status: 400 }
        );
      }
      updates.push('bio = ?');
      params.push(bio || null);
    }

    // v1.1: Validate and add profile CSS
    if (profileCss !== undefined) {
      if (profileCss && profileCss.length > 10000) {
        return NextResponse.json(
          { error: 'Profile CSS too long (max 10000 characters)' },
          { status: 400 }
        );
      }

      // Comprehensive CSS sanitization with scoping and validation
      let sanitizedCss: string | null = null;
      if (profileCss) {
        sanitizedCss = sanitizeProfileCSS(profileCss);
        if (sanitizedCss === null) {
          return NextResponse.json(
            { error: 'Invalid CSS: security validation failed' },
            { status: 400 }
          );
        }
      }

      updates.push('profile_css = ?');
      params.push(sanitizedCss);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push('updated_at = unixepoch()');
    params.push(session.user.id);

    await db.prepare(`
      UPDATE users SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);

    // Return updated user
    const user = await db.prepare(`
      SELECT id, username, display_name, email, avatar_url, bio, profile_css, is_admin, created_at
      FROM users WHERE id = ?
    `).get<{
      id: string;
      username: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
      bio: string | null;
      profile_css: string | null;
      is_admin: number;
      created_at: number;
    }>(session.user.id);

    return NextResponse.json({
      id: user!.id,
      username: user!.username,
      displayName: user!.display_name,
      email: user!.email,
      avatarUrl: user!.avatar_url,
      bio: user!.bio,
      profileCss: user!.profile_css,
      isAdmin: user!.is_admin === 1,
      createdAt: user!.created_at,
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}