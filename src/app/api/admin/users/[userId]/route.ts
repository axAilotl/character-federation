import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { deleteCard } from '@/lib/db/cards';
import { getDatabase } from '@/lib/db/async-db';

/**
 * DELETE /api/admin/users/[userId]
 * Delete a user and all their associated data (admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    // Check authentication and admin status
    const session = await getSession();
    if (!session || !session.user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Prevent self-deletion
    if (session.user.id === userId) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // Get all cards owned by this user
    const userCards = await db.prepare('SELECT id FROM cards WHERE uploader_id = ?').all<{ id: string }>(userId);

    // Delete each card (this handles all card-related cleanup)
    for (const card of userCards) {
      await deleteCard(card.id);
    }

    // Delete user's votes
    await db.prepare('DELETE FROM votes WHERE user_id = ?').run(userId);

    // Delete user's favorites
    await db.prepare('DELETE FROM favorites WHERE user_id = ?').run(userId);

    // Delete user's comments
    await db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId);

    // Delete user's reports
    await db.prepare('DELETE FROM reports WHERE reporter_id = ?').run(userId);

    // Delete user's sessions
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    // Delete the user
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
