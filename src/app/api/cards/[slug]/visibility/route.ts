import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getCardBySlug, updateCardVisibility } from '@/lib/db/cards';
import { z } from 'zod';

const OwnerVisibilitySchema = z.object({
  visibility: z.enum(['public', 'private', 'unlisted']),
});

/**
 * PUT /api/cards/[slug]/visibility
 * Update card visibility (owner only - limited options)
 * Owners can set: public, private, unlisted
 * Only admins can set: nsfw_only, blocked (via admin endpoint)
 */
export async function PUT(
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

    // Get the card
    const card = await getCardBySlug(slug);
    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    // Check ownership (admins use the admin endpoint instead)
    if (card.uploader?.id !== session.user.id) {
      return NextResponse.json(
        { error: 'You can only change visibility of your own cards' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = OwnerVisibilitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid visibility value' },
        { status: 400 }
      );
    }

    const { visibility } = parsed.data;

    await updateCardVisibility(card.id, visibility);

    return NextResponse.json({ success: true, visibility });
  } catch (error) {
    console.error('Error updating card visibility:', error);
    return NextResponse.json(
      { error: 'Failed to update visibility' },
      { status: 500 }
    );
  }
}
