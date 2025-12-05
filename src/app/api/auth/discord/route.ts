import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getDiscordCredentials, getAppUrl } from '@/lib/cloudflare/env';

/**
 * GET /api/auth/discord
 * Initiates Discord OAuth flow - redirects to Discord authorization page
 */
export async function GET() {
  const creds = await getDiscordCredentials();
  const appUrl = await getAppUrl();
  const redirectUri = `${appUrl}/api/auth/discord/callback`;

  if (!creds) {
    return NextResponse.json(
      { error: 'Discord OAuth not configured' },
      { status: 500 }
    );
  }

  // Generate state for CSRF protection
  const state = nanoid(32);

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
  });

  const response = NextResponse.redirect(
    `https://discord.com/api/oauth2/authorize?${params}`
  );

  // Store state in cookie for verification
  response.cookies.set('discord_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60, // 10 minutes
    path: '/',
  });

  return response;
}
