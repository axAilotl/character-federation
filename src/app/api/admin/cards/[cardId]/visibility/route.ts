import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { updateCardVisibility } from '@/lib/db/cards';
import { parseBody, UpdateVisibilitySchema } from '@/lib/validations';

/**
 * PUT /api/admin/cards/[cardId]/visibility
 * Update card visibility (admin only)
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
    const parsed = await parseBody(request, UpdateVisibilitySchema);
    if ('error' in parsed) return parsed.error;
    const { visibility } = parsed.data;

    await updateCardVisibility(cardId, visibility);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating card visibility:', error);
    return NextResponse.json(
      { error: 'Failed to update visibility' },
      { status: 500 }
    );
  }
}
