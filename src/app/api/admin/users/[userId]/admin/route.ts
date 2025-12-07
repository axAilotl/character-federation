import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { parseBody, ToggleAdminSchema } from '@/lib/validations';

/**
 * PUT /api/admin/users/[userId]/admin
 * Toggle admin status for a user (admin only)
 */
export async function PUT(
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

    // Prevent self-modification
    if (session.user.id === userId) {
      return NextResponse.json(
        { error: 'Cannot modify your own admin status' },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const parsed = await parseBody(request, ToggleAdminSchema);
    if ('error' in parsed) return parsed.error;
    const { isAdmin } = parsed.data;

    const db = await getDatabase();
    await db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating user admin status:', error);
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}
