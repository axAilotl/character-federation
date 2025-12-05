import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { updateModerationState } from '@/lib/db/cards';
import { parseBody, UpdateModerationSchema } from '@/lib/validations';

/**
 * PUT /api/admin/cards/[cardId]/moderation
 * Update card moderation state (admin only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  try {
    const { cardId } = await params;

    // Check authentication and admin status
    const session = await getSession();
    if (!session || !session.user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const parsed = await parseBody(request, UpdateModerationSchema);
    if ('error' in parsed) return parsed.error;
    const { state } = parsed.data;

    await updateModerationState(cardId, state);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating card moderation state:', error);
    return NextResponse.json(
      { error: 'Failed to update moderation state' },
      { status: 500 }
    );
  }
}
