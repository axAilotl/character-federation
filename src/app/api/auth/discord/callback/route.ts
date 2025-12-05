import { NextRequest, NextResponse } from 'next/server';
import { loginWithOAuth, SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS } from '@/lib/auth';
import { getDiscordCredentials, getAppUrl } from '@/lib/cloudflare/env';

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  email?: string;
  verified?: boolean;
}

/**
 * GET /api/auth/discord/callback
 * Handles Discord OAuth callback - exchanges code for token, creates/logs in user
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const baseUrl = await getAppUrl();

  // Handle OAuth errors
  if (error) {
    console.error('Discord OAuth error:', error);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, baseUrl));
  }

  // Verify state and code
  const storedState = request.cookies.get('discord_oauth_state')?.value;

  if (!code || !state) {
    return NextResponse.redirect(new URL('/login?error=missing_code', baseUrl));
  }

  if (state !== storedState) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', baseUrl));
  }

  const creds = await getDiscordCredentials();
  const redirectUri = `${baseUrl}/api/auth/discord/callback`;

  if (!creds) {
    console.error('Discord OAuth not configured');
    return NextResponse.redirect(new URL('/login?error=not_configured', baseUrl));
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Discord token error:', errorText);
      return NextResponse.redirect(new URL('/login?error=token_failed', baseUrl));
    }

    const tokenData: DiscordTokenResponse = await tokenResponse.json();

    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL('/login?error=no_token', baseUrl));
    }

    // Fetch user info from Discord
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('Discord user fetch error:', errorText);
      return NextResponse.redirect(new URL('/login?error=user_fetch_failed', baseUrl));
    }

    const discordUser: DiscordUser = await userResponse.json();

    // Build avatar URL
    let avatarUrl: string | null = null;
    if (discordUser.avatar) {
      const ext = discordUser.avatar.startsWith('a_') ? 'gif' : 'png';
      avatarUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}`;
    }

    // Login or register with OAuth
    const { sessionId } = await loginWithOAuth('discord', discordUser.id, {
      email: discordUser.email,
      username: discordUser.username,
      displayName: discordUser.global_name || discordUser.username,
      avatarUrl,
    });

    // Redirect to home with session cookie
    const response = NextResponse.redirect(new URL('/', baseUrl));

    // Set session cookie
    response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
      path: '/',
    });

    // Clear OAuth state cookie
    response.cookies.delete('discord_oauth_state');

    return response;
  } catch (err) {
    console.error('Discord OAuth error:', err);
    return NextResponse.redirect(new URL('/login?error=oauth_failed', baseUrl));
  }
}
