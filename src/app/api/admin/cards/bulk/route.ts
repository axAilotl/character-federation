import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import { parseBody, VisibilitySchema, ModerationStateSchema, NanoIdSchema } from '@/lib/validations';

// Bulk update schema
const BulkUpdateSchema = z.object({
  cardIds: z.array(NanoIdSchema).min(1, 'At least one card ID required').max(100, 'Cannot update more than 100 cards at once'),
  visibility: VisibilitySchema.optional(),
  moderationState: ModerationStateSchema.optional(),
});

// Bulk delete schema
const BulkDeleteSchema = z.object({
  cardIds: z.array(NanoIdSchema).min(1, 'At least one card ID required').max(100, 'Cannot delete more than 100 cards at once'),
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

    const db = await getDatabase();

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

/**
 * DELETE /api/admin/cards/bulk
 * Bulk delete cards (admin only)
 */
export async function DELETE(request: NextRequest) {
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
    const parsed = await parseBody(request, BulkDeleteSchema);
    if ('error' in parsed) return parsed.error;
    const { cardIds } = parsed.data;

    const db = await getDatabase();

    // Delete related data first (foreign key constraints)
    const placeholders = cardIds.map(() => '?').join(', ');

    // Delete card versions
    await db.prepare(`DELETE FROM card_versions WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Delete card tags
    await db.prepare(`DELETE FROM card_tags WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Delete votes
    await db.prepare(`DELETE FROM votes WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Delete favorites
    await db.prepare(`DELETE FROM favorites WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Delete comments
    await db.prepare(`DELETE FROM comments WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Delete downloads
    await db.prepare(`DELETE FROM downloads WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Delete reports
    await db.prepare(`DELETE FROM reports WHERE card_id IN (${placeholders})`).run(...cardIds);

    // Finally delete the cards
    await db.prepare(`DELETE FROM cards WHERE id IN (${placeholders})`).run(...cardIds);

    return NextResponse.json({
      success: true,
      deleted: cardIds.length,
    });
  } catch (error) {
    console.error('Error bulk deleting cards:', error);
    return NextResponse.json(
      { error: 'Failed to delete cards' },
      { status: 500 }
    );
  }
}
