import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';

/**
 * GET /api/users/me/tags
 * Get current user's tag preferences (followed and blocked tags)
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const db = await getDatabase();
    const preferences = await db.prepare(`
      SELECT tp.tag_id, tp.preference, t.name, t.slug, t.category
      FROM tag_preferences tp
      JOIN tags t ON tp.tag_id = t.id
      WHERE tp.user_id = ?
      ORDER BY t.name
    `).all<{
      tag_id: number;
      preference: 'follow' | 'block';
      name: string;
      slug: string;
      category: string | null;
    }>(session.user.id);

    const followed = preferences.filter(p => p.preference === 'follow').map(p => ({
      id: p.tag_id,
      name: p.name,
      slug: p.slug,
      category: p.category,
    }));

    const blocked = preferences.filter(p => p.preference === 'block').map(p => ({
      id: p.tag_id,
      name: p.name,
      slug: p.slug,
      category: p.category,
    }));

    return NextResponse.json({ followed, blocked });
  } catch (error) {
    console.error('Error fetching tag preferences:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tag preferences' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/users/me/tags
 * Update a tag preference (follow/block/remove)
 * Body: { tagId: number, preference: 'follow' | 'block' | null }
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
    const { tagId, preference } = body;

    if (!tagId || typeof tagId !== 'number') {
      return NextResponse.json(
        { error: 'Invalid tag ID' },
        { status: 400 }
      );
    }

    if (preference !== null && preference !== 'follow' && preference !== 'block') {
      return NextResponse.json(
        { error: 'Invalid preference (must be "follow", "block", or null)' },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // Verify tag exists
    const tag = await db.prepare('SELECT id FROM tags WHERE id = ?').get<{ id: number }>(tagId);
    if (!tag) {
      return NextResponse.json(
        { error: 'Tag not found' },
        { status: 404 }
      );
    }

    if (preference === null) {
      // Remove preference
      await db.prepare(
        'DELETE FROM tag_preferences WHERE user_id = ? AND tag_id = ?'
      ).run(session.user.id, tagId);
    } else {
      // Upsert preference
      await db.prepare(`
        INSERT INTO tag_preferences (user_id, tag_id, preference, created_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT (user_id, tag_id) DO UPDATE SET preference = ?
      `).run(session.user.id, tagId, preference, preference);
    }

    return NextResponse.json({ success: true, tagId, preference });
  } catch (error) {
    console.error('Error updating tag preference:', error);
    return NextResponse.json(
      { error: 'Failed to update tag preference' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users/me/tags
 * Bulk update tag preferences
 * Body: { follow: number[], block: number[] }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { follow = [], block = [] } = body;

    if (!Array.isArray(follow) || !Array.isArray(block)) {
      return NextResponse.json(
        { error: 'Invalid format (follow and block must be arrays)' },
        { status: 400 }
      );
    }

    // Limit total preferences
    if (follow.length + block.length > 100) {
      return NextResponse.json(
        { error: 'Too many tag preferences (max 100)' },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // Clear existing preferences
    await db.prepare('DELETE FROM tag_preferences WHERE user_id = ?').run(session.user.id);

    // Insert follow preferences
    for (const tagId of follow) {
      if (typeof tagId === 'number') {
        await db.prepare(`
          INSERT OR IGNORE INTO tag_preferences (user_id, tag_id, preference, created_at)
          VALUES (?, ?, 'follow', unixepoch())
        `).run(session.user.id, tagId);
      }
    }

    // Insert block preferences
    for (const tagId of block) {
      if (typeof tagId === 'number') {
        await db.prepare(`
          INSERT OR IGNORE INTO tag_preferences (user_id, tag_id, preference, created_at)
          VALUES (?, ?, 'block', unixepoch())
        `).run(session.user.id, tagId);
      }
    }

    return NextResponse.json({ success: true, followCount: follow.length, blockCount: block.length });
  } catch (error) {
    console.error('Error bulk updating tag preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update tag preferences' },
      { status: 500 }
    );
  }
}
