import { NextResponse } from 'next/server';
import { getAllTags } from '@/lib/db/cards';

let cachedTags: Awaited<ReturnType<typeof getAllTags>> | null = null;
let cachedAt = 0;
const TAG_CACHE_TTL_MS = 60_000;

/**
 * GET /api/tags
 * Get all tags grouped by category
 */
export async function GET() {
  try {
    const now = Date.now();
    if (cachedTags && now - cachedAt < TAG_CACHE_TTL_MS) {
      return NextResponse.json(cachedTags, { headers: { 'Cache-Control': 'public, max-age=60' } });
    }

    const tags = await getAllTags();
    cachedTags = tags;
    cachedAt = now;
    return NextResponse.json(tags, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (error) {
    console.error('Error fetching tags:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}
