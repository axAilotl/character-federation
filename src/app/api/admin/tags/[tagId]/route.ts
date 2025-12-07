import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';

/**
 * PUT /api/admin/tags/[tagId]
 * Update a tag (name, category, blocked status)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  try {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { tagId } = await params;
    const id = parseInt(tagId);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
    }

    const body = await request.json();
    const { name, category, isBlocked } = body;

    const db = await getDatabase();

    // Check if tag exists
    const existing = await db.prepare('SELECT id, slug FROM tags WHERE id = ?').get<{ id: number; slug: string }>(id);
    if (!existing) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Build update query
    const updates: string[] = [];
    const updateParams: (string | number | null)[] = [];

    if (name !== undefined) {
      const newSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Check if new slug conflicts with another tag
      if (newSlug !== existing.slug) {
        const conflict = await db.prepare('SELECT id FROM tags WHERE slug = ? AND id != ?').get<{ id: number }>(newSlug, id);
        if (conflict) {
          return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
        }
      }

      updates.push('name = ?', 'slug = ?');
      updateParams.push(name.trim(), newSlug);
    }

    if (category !== undefined) {
      updates.push('category = ?');
      updateParams.push(category || null);
    }

    if (isBlocked !== undefined) {
      updates.push('is_blocked = ?');
      updateParams.push(isBlocked ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    await db.prepare(`
      UPDATE tags SET ${updates.join(', ')} WHERE id = ?
    `).run(...updateParams, id);

    const updated = await db.prepare(`
      SELECT id, name, slug, category, usage_count, COALESCE(is_blocked, 0) as is_blocked
      FROM tags WHERE id = ?
    `).get<{
      id: number;
      name: string;
      slug: string;
      category: string | null;
      usage_count: number;
      is_blocked: number;
    }>(id);

    return NextResponse.json({
      id: updated?.id,
      name: updated?.name,
      slug: updated?.slug,
      category: updated?.category,
      usageCount: updated?.usage_count,
      isBlocked: updated?.is_blocked === 1,
    });
  } catch (error) {
    console.error('Error updating tag:', error);
    return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/tags/[tagId]
 * Delete a tag (removes from all cards)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  try {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { tagId } = await params;
    const id = parseInt(tagId);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
    }

    const db = await getDatabase();

    // Check if tag exists
    const existing = await db.prepare('SELECT id, name, usage_count FROM tags WHERE id = ?').get<{
      id: number;
      name: string;
      usage_count: number;
    }>(id);

    if (!existing) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Delete tag (cascades to card_tags via ON DELETE CASCADE)
    await db.prepare('DELETE FROM tags WHERE id = ?').run(id);

    return NextResponse.json({
      success: true,
      message: `Deleted tag "${existing.name}" (was used by ${existing.usage_count} cards)`
    });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}
