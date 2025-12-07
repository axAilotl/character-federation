import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { parseQuery, SearchQuerySchema } from '@/lib/validations';

interface SearchResult {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator: string | null;
  thumbnailPath: string | null;
  tokensTotal: number;
  upvotes: number;
  downvotes: number;
  downloadsCount: number;
  rank: number;
  snippet: string | null;
}

/**
 * GET /api/search
 * Full-text search with ranking and snippets
 */
export async function GET(request: NextRequest) {
  try {
    // Parse and validate query parameters
    const parsed = parseQuery(request.nextUrl.searchParams, SearchQuerySchema);
    if ('error' in parsed) return parsed.error;
    const { q: query, limit, offset, nsfw: includeNsfw } = parsed.data;

    if (!query || query.trim().length < 2) {
      return NextResponse.json({
        items: [],
        total: 0,
        query: query,
      });
    }

    const db = await getDatabase();

    // Build FTS5 query with prefix matching
    const searchTerm = query.trim();
    const ftsQuery = searchTerm
      .replace(/[\"\']/g, '')
      .split(/\s+/)
      .filter(word => word.length >= 2)
      .map(word => `"${word}"*`)
      .join(' ');

    if (!ftsQuery) {
      return NextResponse.json({
        items: [],
        total: 0,
        query: query,
      });
    }

    // Visibility filter
    const visibilityCondition = includeNsfw
      ? `c.visibility IN ('public', 'nsfw_only')`
      : `c.visibility = 'public'`;

    // Count total results
    const countQuery = `
      SELECT COUNT(*) as total
      FROM cards c
      INNER JOIN cards_fts fts ON c.id = fts.card_id
      WHERE cards_fts MATCH ?
        AND ${visibilityCondition}
        AND c.moderation_state != 'blocked'
    `;
    const totalResult = await db.prepare(countQuery).get<{ total: number }>(ftsQuery);

    // Get ranked results with BM25 scoring and snippets
    // Note: bm25() column indices: 0=card_id (unindexed), 1=name, 2=description, 3=creator, 4=creator_notes
    const searchQuery = `
      SELECT
        c.id,
        c.slug,
        c.name,
        c.description,
        c.creator,
        v.thumbnail_path,
        v.tokens_total,
        c.upvotes,
        c.downvotes,
        c.downloads_count,
        bm25(cards_fts, 0.0, 10.0, 5.0, 2.0, 1.0) as rank,
        snippet(cards_fts, 2, '<mark>', '</mark>', '...', 32) as snippet
      FROM cards c
      INNER JOIN cards_fts fts ON c.id = fts.card_id
      LEFT JOIN card_versions v ON c.head_version_id = v.id
      WHERE cards_fts MATCH ?
        AND ${visibilityCondition}
        AND c.moderation_state != 'blocked'
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;

    const rows = await db.prepare(searchQuery).all<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      creator: string | null;
      thumbnail_path: string | null;
      tokens_total: number;
      upvotes: number;
      downvotes: number;
      downloads_count: number;
      rank: number;
      snippet: string | null;
    }>(ftsQuery, limit, offset);

    const items: SearchResult[] = rows.map(row => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      creator: row.creator,
      thumbnailPath: row.thumbnail_path,
      tokensTotal: row.tokens_total,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      downloadsCount: row.downloads_count,
      rank: row.rank,
      snippet: row.snippet,
    }));

    return NextResponse.json({
      items,
      total: totalResult?.total || 0,
      query: query,
      hasMore: offset + items.length < (totalResult?.total || 0),
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
