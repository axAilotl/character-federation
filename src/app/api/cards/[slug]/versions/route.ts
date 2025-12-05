import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';
import { getCardVersions } from '@/lib/db/cards';

/**
 * GET /api/cards/[slug]/versions
 * Get version history for a card
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Get card ID from slug
    const db = getAsyncDb();
    const card = await db.prepare('SELECT id, head_version_id FROM cards WHERE slug = ?').get<{
      id: string;
      head_version_id: string | null;
    }>(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    // Get all versions
    const versions = await getCardVersions(card.id);

    // Format response
    const formattedVersions = versions.map((v) => ({
      id: v.id,
      isHead: v.id === card.head_version_id,
      parentVersionId: v.parent_version_id,
      forkedFromId: v.forked_from_id,
      specVersion: v.spec_version,
      sourceFormat: v.source_format,
      tokensTotal: v.tokens_total,
      contentHash: v.content_hash,
      createdAt: v.created_at,
    }));

    return NextResponse.json({
      versions: formattedVersions,
      headVersionId: card.head_version_id,
      total: versions.length,
    });
  } catch (error) {
    console.error('Error fetching versions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch versions' },
      { status: 500 }
    );
  }
}
