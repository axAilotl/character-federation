import { getAsyncDb } from '@/lib/db/async-db';
import { type UserRow } from '@/lib/db';
import { nanoid } from 'nanoid';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';

const SESSION_COOKIE_NAME = 'cardshub_session';
const SESSION_EXPIRY_DAYS = 30;
const BCRYPT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Support legacy SHA-256 hashes during migration
  if (hash.length === 64 && /^[a-f0-9]+$/.test(hash)) {
    const crypto = await import('crypto');
    const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
    return sha256Hash === hash;
  }
  return bcrypt.compare(password, hash);
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}

// Create admin user if it doesn't exist (opt-in)
export async function ensureAdminUser(): Promise<void> {
  const allowBootstrap = process.env.ALLOW_AUTO_ADMIN === 'true' || process.env.NODE_ENV === 'development';
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  // Disable silent default admin in production unless explicitly enabled with a password
  if (!allowBootstrap || !bootstrapPassword || process.env.NODE_ENV === 'production') {
    return;
  }

  const db = getAsyncDb();
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get('admin');

  if (!existing) {
    const id = nanoid();
    const passwordHash = await hashPassword(bootstrapPassword);
    await db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, is_admin, provider)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, 'admin', 'Administrator', passwordHash, 1, 'local');
  }
}

// Login with username and password
export async function login(username: string, password: string): Promise<{ user: User; sessionId: string } | null> {
  const db = getAsyncDb();

  const user = await db.prepare(`
    SELECT id, username, display_name, password_hash, is_admin
    FROM users WHERE username = ?
  `).get<UserRow>(username);

  if (!user || !user.password_hash) {
    return null;
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  // Create session
  const sessionId = nanoid(32);
  const expiresAt = Math.floor(Date.now() / 1000) + (SESSION_EXPIRY_DAYS * 24 * 60 * 60);

  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, user.id, expiresAt);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isAdmin: user.is_admin === 1,
    },
    sessionId,
  };
}

// Logout - delete session
export async function logout(sessionId: string): Promise<void> {
  const db = getAsyncDb();
  await db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// Get session from cookie
export async function getSession(): Promise<{ user: User; session: Session } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return null;
  }

  return getSessionById(sessionId);
}

// Get session by ID
export async function getSessionById(sessionId: string): Promise<{ user: User; session: Session } | null> {
  const db = getAsyncDb();

  const result = await db.prepare(`
    SELECT
      s.id as session_id,
      s.user_id,
      s.expires_at,
      u.username,
      u.display_name,
      u.is_admin
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get<{
    session_id: string;
    user_id: string;
    expires_at: number;
    username: string;
    display_name: string | null;
    is_admin: number;
  }>(sessionId);

  if (!result) {
    return null;
  }

  // Check if session expired
  const now = Math.floor(Date.now() / 1000);
  if (result.expires_at < now) {
    // Delete expired session
    await db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }

  return {
    user: {
      id: result.user_id,
      username: result.username,
      displayName: result.display_name,
      isAdmin: result.is_admin === 1,
    },
    session: {
      id: result.session_id,
      userId: result.user_id,
      expiresAt: result.expires_at,
    },
  };
}

// Register a new user
export async function register(username: string, password: string): Promise<{ user: User; sessionId: string } | { error: string }> {
  const db = getAsyncDb();

  // Check if username exists
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return { error: 'Username already taken' };
  }

  // Create user
  const id = nanoid();
  const passwordHash = await hashPassword(password);

  await db.prepare(`
    INSERT INTO users (id, username, password_hash, is_admin, provider)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, username, passwordHash, 0, 'local');

  // Create session
  const sessionId = nanoid(32);
  const expiresAt = Math.floor(Date.now() / 1000) + (SESSION_EXPIRY_DAYS * 24 * 60 * 60);

  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, id, expiresAt);

  return {
    user: {
      id,
      username,
      displayName: null,
      isAdmin: false,
    },
    sessionId,
  };
}

// OAuth login/register - find or create user by provider
export async function loginWithOAuth(provider: string, providerId: string, profile: {
  email?: string | null;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<{ user: User; sessionId: string }> {
  const db = getAsyncDb();

  // Check if user exists with this provider
  let user = await db.prepare(`
    SELECT id, username, display_name, is_admin
    FROM users WHERE provider = ? AND provider_id = ?
  `).get<UserRow>(provider, providerId);

  if (!user) {
    // Check if username is taken
    let username = profile.username;
    const existingUsername = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUsername) {
      // Append random suffix to username
      username = `${username}_${nanoid(4)}`;
    }

    // Create new user
    const id = nanoid();
    await db.prepare(`
      INSERT INTO users (id, email, username, display_name, avatar_url, is_admin, provider, provider_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      profile.email || null,
      username,
      profile.displayName || username,
      profile.avatarUrl || null,
      0,
      provider,
      providerId
    );

    user = { id, username, display_name: profile.displayName || username, is_admin: 0 } as UserRow;
  }

  // Create session
  const sessionId = nanoid(32);
  const expiresAt = Math.floor(Date.now() / 1000) + (SESSION_EXPIRY_DAYS * 24 * 60 * 60);

  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, user.id, expiresAt);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isAdmin: user.is_admin === 1,
    },
    sessionId,
  };
}

// Update user password (for admin break-glass)
export async function updatePassword(userId: string, newPassword: string): Promise<boolean> {
  const db = getAsyncDb();
  const passwordHash = await hashPassword(newPassword);

  const result = await db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(passwordHash, userId);

  return result.changes > 0;
}

// Update password by username (for admin break-glass via CLI or route)
export async function updatePasswordByUsername(username: string, newPassword: string): Promise<boolean> {
  const db = getAsyncDb();
  const passwordHash = await hashPassword(newPassword);

  const result = await db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = unixepoch()
    WHERE username = ?
  `).run(passwordHash, username);

  return result.changes > 0;
}

export { SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS };
