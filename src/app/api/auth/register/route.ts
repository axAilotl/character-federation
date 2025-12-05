import { NextRequest, NextResponse } from 'next/server';
import { register, SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS } from '@/lib/auth';
import { applyRateLimit, getClientId } from '@/lib/rate-limit';
import { parseBody, RegisterSchema } from '@/lib/validations';
import { logAuthEvent, logRateLimit, logError } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const clientId = getClientId(request);

  try {
    // Apply rate limiting
    const rl = applyRateLimit(clientId, 'register');
    logRateLimit(clientId, 'register', rl.allowed, rl.remaining);

    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': (rl.retryAfter || 600).toString() } }
      );
    }

    const parsed = await parseBody(request, RegisterSchema);
    if ('error' in parsed) return parsed.error;

    const { username, password } = parsed.data;
    const result = await register(username, password);

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    logAuthEvent('register', result.user.id, { username, ip: clientId });

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
    logError({ ip: clientId, path: '/api/auth/register' }, error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
