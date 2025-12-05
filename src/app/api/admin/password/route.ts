import { NextRequest, NextResponse } from 'next/server';
import { getSession, updatePasswordByUsername } from '@/lib/auth';

/**
 * PUT /api/admin/password
 * Change a user's password (admin only, or own password)
 * Body: { username: string, newPassword: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { username, newPassword } = await request.json();

    if (!username || !newPassword) {
      return NextResponse.json(
        { error: 'Username and new password are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Only admins can change other users' passwords
    // Non-admins can only change their own password
    if (!session.user.isAdmin && session.user.username !== username) {
      return NextResponse.json(
        { error: 'You can only change your own password' },
        { status: 403 }
      );
    }

    const success = await updatePasswordByUsername(username, newPassword);

    if (!success) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Password updated for user: ${username}`,
    });
  } catch (error) {
    console.error('Error updating password:', error);
    return NextResponse.json(
      { error: 'Failed to update password' },
      { status: 500 }
    );
  }
}
