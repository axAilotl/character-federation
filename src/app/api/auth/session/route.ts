import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, ensureAdminUser, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    // Ensure admin user exists on every session check
    await ensureAdminUser();

    const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionId) {
      return NextResponse.json({ user: null });
    }

    const result = await getSessionById(sessionId);

    if (!result) {
      const response = NextResponse.json({ user: null });
      // Clear invalid session cookie
      response.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
      return response;
    }

    return NextResponse.json({
      user: result.user,
    });
  } catch (error) {
    console.error('Session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
