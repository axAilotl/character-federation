import { NextRequest, NextResponse } from 'next/server';
import { login, ensureAdminUser, SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Ensure admin user exists
    await ensureAdminUser();

    const result = await login(username, password);

    if (!result) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      user: result.user,
    });

    // Set session cookie
    response.cookies.set(SESSION_COOKIE_NAME, result.sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
