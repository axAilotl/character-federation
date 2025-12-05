import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import { parseBody, VisibilitySchema, ModerationStateSchema, NanoIdSchema } from '@/lib/validations';

// Bulk update schema
const BulkUpdateSchema = z.object({
  cardIds: z.array(NanoIdSchema).min(1, 'At least one card ID required').max(100, 'Cannot update more than 100 cards at once'),
  visibility: VisibilitySchema.optional(),
  moderationState: ModerationStateSchema.optional(),
});

/**
 * PUT /api/admin/cards/bulk
 * Bulk update card visibility or moderation state (admin only)
 */
export async function PUT(request: NextRequest) {
  try {
    // Check authentication and admin status
    const session = await getSession();
    if (!session || !session.user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const parsed = await parseBody(request, BulkUpdateSchema);
    if ('error' in parsed) return parsed.error;
    const { cardIds, visibility, moderationState } = parsed.data;

    const db = getAsyncDb();

    // Update visibility if provided
    if (visibility) {
      const placeholders = cardIds.map(() => '?').join(', ');
      await db.prepare(`
        UPDATE cards
        SET visibility = ?, updated_at = unixepoch()
        WHERE id IN (${placeholders})
      `).run(visibility, ...cardIds);
    }

    // Update moderation state if provided
    if (moderationState) {
      const placeholders = cardIds.map(() => '?').join(', ');
      await db.prepare(`
        UPDATE cards
        SET moderation_state = ?, updated_at = unixepoch()
        WHERE id IN (${placeholders})
      `).run(moderationState, ...cardIds);
    }

    return NextResponse.json({
      success: true,
      updated: cardIds.length,
    });
  } catch (error) {
    console.error('Error bulk updating cards:', error);
    return NextResponse.json(
      { error: 'Failed to update cards' },
      { status: 500 }
    );
  }
}
