import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';
import { getSession } from '@/lib/auth';
import { parseBody, UpdateReportStatusSchema } from '@/lib/validations';

/**
 * PUT /api/admin/reports/[reportId]
 * Update report status (admin only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;

    // Check authentication and admin status
    const session = await getSession();
    if (!session || !session.user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const parsed = await parseBody(request, UpdateReportStatusSchema);
    if ('error' in parsed) return parsed.error;
    const { status } = parsed.data;

    const db = getAsyncDb();
    await db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating report status:', error);
    return NextResponse.json(
      { error: 'Failed to update report status' },
      { status: 500 }
    );
  }
}
