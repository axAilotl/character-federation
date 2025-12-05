import { NextRequest, NextResponse } from 'next/server';
import { login, SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS } from '@/lib/auth';
import { applyRateLimit, getClientId } from '@/lib/rate-limit';
import { parseBody, LoginSchema } from '@/lib/validations';
import { logAuthEvent, logRateLimit, logError } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const clientId = getClientId(request);

  try {
    // Apply rate limiting
    const rl = applyRateLimit(clientId, 'login');
    logRateLimit(clientId, 'login', rl.allowed, rl.remaining);

    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait before retrying.' },
        { status: 429, headers: { 'Retry-After': (rl.retryAfter || 60).toString() } }
      );
    }

    const parsed = await parseBody(request, LoginSchema);
    if ('error' in parsed) return parsed.error;

    const { username, password } = parsed.data;
    const result = await login(username, password);

    if (!result) {
      logAuthEvent('login_failed', undefined, { username, ip: clientId });
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    logAuthEvent('login', result.user.id, { username, ip: clientId });

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
    logError({ ip: clientId, path: '/api/auth/login' }, error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
