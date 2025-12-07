import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';

interface TagRow {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  usage_count: number;
  is_blocked: number;
}

/**
 * GET /api/admin/tags
 * List all tags with admin info (blocked status, usage counts)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const filter = searchParams.get('filter') || 'all'; // 'all', 'blocked', 'active'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = (page - 1) * limit;

    const db = await getDatabase();

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (search) {
      conditions.push('(name LIKE ? OR slug LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (filter === 'blocked') {
      conditions.push('is_blocked = 1');
    } else if (filter === 'active') {
      conditions.push('is_blocked = 0');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await db.prepare(`
      SELECT COUNT(*) as total FROM tags ${whereClause}
    `).get<{ total: number }>(...params);

    // Get tags
    const rows = await db.prepare(`
      SELECT id, name, slug, category, usage_count, COALESCE(is_blocked, 0) as is_blocked
      FROM tags
      ${whereClause}
      ORDER BY usage_count DESC, name ASC
      LIMIT ? OFFSET ?
    `).all<TagRow>(...params, limit, offset);

    const items = rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      usageCount: row.usage_count,
      isBlocked: row.is_blocked === 1,
    }));

    return NextResponse.json({
      items,
      total: countResult?.total || 0,
      page,
      limit,
      hasMore: offset + items.length < (countResult?.total || 0),
    });
  } catch (error) {
    console.error('Error fetching admin tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

/**
 * POST /api/admin/tags
 * Create a new tag
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, category, isBlocked } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const db = await getDatabase();

    // Check if tag already exists
    const existing = await db.prepare('SELECT id FROM tags WHERE slug = ?').get<{ id: number }>(slug);
    if (existing) {
      return NextResponse.json({ error: 'Tag already exists' }, { status: 409 });
    }

    // Insert tag
    await db.prepare(`
      INSERT INTO tags (name, slug, category, is_blocked, usage_count)
      VALUES (?, ?, ?, ?, 0)
    `).run(name.trim(), slug, category || null, isBlocked ? 1 : 0);

    const newTag = await db.prepare('SELECT * FROM tags WHERE slug = ?').get<TagRow>(slug);

    return NextResponse.json({
      id: newTag?.id,
      name: newTag?.name,
      slug: newTag?.slug,
      category: newTag?.category,
      usageCount: 0,
      isBlocked: newTag?.is_blocked === 1,
    });
  } catch (error) {
    console.error('Error creating tag:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}
