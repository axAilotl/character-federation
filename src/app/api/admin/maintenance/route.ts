import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getMaintenanceMode, setMaintenanceMode } from '@/lib/maintenance';

/**
 * GET /api/admin/maintenance
 * Get current maintenance mode settings
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const settings = await getMaintenanceMode();
    return NextResponse.json(settings);
  } catch (error) {
    console.error('[Admin Maintenance] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get maintenance mode' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/maintenance
 * Update maintenance mode settings
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { enabled, message } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    await setMaintenanceMode(enabled, message);

    console.log(`[Admin] Maintenance mode ${enabled ? 'enabled' : 'disabled'} by ${session.user.username}`);

    return NextResponse.json({ success: true, enabled, message });
  } catch (error) {
    console.error('[Admin Maintenance] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update maintenance mode' },
      { status: 500 }
    );
  }
}
