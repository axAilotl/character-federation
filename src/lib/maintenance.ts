/**
 * Maintenance Mode
 *
 * Simple flag to disable the site for non-admins.
 * Stored in a singleton table in the database.
 */

import { getDatabase } from './db/async-db';

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}

/**
 * Get current maintenance mode settings
 */
export async function getMaintenanceMode(): Promise<MaintenanceSettings> {
  const db = await getDatabase();

  const result = await db.prepare(`
    SELECT value FROM settings WHERE key = 'maintenance_mode'
  `).get<{ value: string }>();

  if (!result) {
    return { enabled: false, message: 'Site is currently under maintenance. Please check back soon.' };
  }

  try {
    return JSON.parse(result.value);
  } catch {
    return { enabled: false, message: 'Site is currently under maintenance. Please check back soon.' };
  }
}

/**
 * Set maintenance mode
 * Only callable by admins
 */
export async function setMaintenanceMode(enabled: boolean, message?: string): Promise<void> {
  const db = await getDatabase();

  const settings: MaintenanceSettings = {
    enabled,
    message: message || 'Site is currently under maintenance. Please check back soon.',
  };

  await db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('maintenance_mode', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
  `).run(JSON.stringify(settings));
}
