#!/usr/bin/env npx tsx
/**
 * Admin Break-Glass Script: Reset user password
 *
 * Usage:
 *   npx tsx scripts/reset-password.ts <username> <new-password>
 *   npm run admin:reset-pw <username> <new-password>
 *
 * Examples:
 *   npx tsx scripts/reset-password.ts admin newSecurePassword123
 */

import { updatePasswordByUsername } from '../src/lib/auth';
import { getDbSync } from '../src/lib/db';

async function main() {
  const [username, newPassword] = process.argv.slice(2);

  if (!username || !newPassword) {
    console.error('Usage: npx tsx scripts/reset-password.ts <username> <new-password>');
    console.error('Example: npx tsx scripts/reset-password.ts admin newSecurePassword123');
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error('Error: Password must be at least 6 characters');
    process.exit(1);
  }

  // Ensure database is initialized (sync version for scripts)
  const db = getDbSync();

  // Check if user exists
  const user = db.prepare('SELECT username, is_admin FROM users WHERE username = ?').get(username) as { username: string; is_admin: number } | undefined;

  if (!user) {
    console.error(`Error: User "${username}" not found`);
    process.exit(1);
  }

  // Update password
  const success = await updatePasswordByUsername(username, newPassword);

  if (success) {
    console.log(`Password updated successfully for user: ${username}`);
    if (user.is_admin) {
      console.log('(This user is an admin)');
    }
  } else {
    console.error('Failed to update password');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
