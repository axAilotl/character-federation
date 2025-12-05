import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';
import { voteOnCard, getUserVote } from '@/lib/db/cards';
import { getSession } from '@/lib/auth';
import { parseBody, VoteSchema } from '@/lib/validations';

/**
 * POST /api/cards/[slug]/vote
 * Vote on a card (upvote or downvote)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Check authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const parsed = await parseBody(request, VoteSchema);
    if ('error' in parsed) return parsed.error;
    const { vote } = parsed.data;

    // Get card ID from slug
    const db = getAsyncDb();
    const card = await db.prepare('SELECT id FROM cards WHERE slug = ?').get<{ id: string }>(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    // Perform vote
    await voteOnCard(session.user.id, card.id, vote);

    // Get updated vote counts
    const updated = await db.prepare('SELECT upvotes, downvotes FROM cards WHERE id = ?').get<{
      upvotes: number;
      downvotes: number;
    }>(card.id);

    // Get user's current vote
    const userVote = await getUserVote(session.user.id, card.id);

    return NextResponse.json({
      success: true,
      data: {
        upvotes: updated?.upvotes || 0,
        downvotes: updated?.downvotes || 0,
        userVote,
      },
    });
  } catch (error) {
    console.error('Error voting on card:', error);
    return NextResponse.json(
      { error: 'Failed to vote on card' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cards/[slug]/vote
 * Remove vote from a card
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Check authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get card ID from slug
    const db = getAsyncDb();
    const card = await db.prepare('SELECT id FROM cards WHERE slug = ?').get<{ id: string }>(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    // Get current vote
    const existingVote = await getUserVote(session.user.id, card.id);

    if (existingVote) {
      // Remove vote by voting the same way (toggles off)
      await voteOnCard(session.user.id, card.id, existingVote as 1 | -1);
    }

    // Get updated vote counts
    const updated = await db.prepare('SELECT upvotes, downvotes FROM cards WHERE id = ?').get<{
      upvotes: number;
      downvotes: number;
    }>(card.id);

    return NextResponse.json({
      success: true,
      data: {
        upvotes: updated?.upvotes || 0,
        downvotes: updated?.downvotes || 0,
        userVote: null,
      },
    });
  } catch (error) {
    console.error('Error removing vote:', error);
    return NextResponse.json(
      { error: 'Failed to remove vote' },
      { status: 500 }
    );
  }
}
