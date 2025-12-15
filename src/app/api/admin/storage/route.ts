/**
 * Admin Storage Management API
 *
 * Provides endpoints for managing R2/file storage:
 * - GET: List storage stats and find orphaned files
 * - DELETE: Clean up orphaned files
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDatabase } from '@/lib/db/async-db';
import { getR2 } from '@/lib/cloudflare/env';
import { parseBody, StorageCleanupSchema } from '@/lib/validations';

interface StorageStats {
  totalObjects: number;
  totalSize: number;
  referencedCount: number;
  orphanedCount: number;
  orphanedSize: number;
  orphanedKeys: string[];
}

/**
 * GET /api/admin/storage
 * Get storage stats and list orphaned files
 * Query params:
 * - limit: max orphans to return (default 100)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

    // Get R2 bucket
    const r2 = await getR2();
    if (!r2) {
      return NextResponse.json(
        { error: 'R2 storage not available' },
        { status: 503 }
      );
    }

    // Collect all R2 objects
    const allObjects: { key: string; size: number }[] = [];
    let cursor: string | undefined;

    do {
      const listResult = await r2.list({ cursor, limit: 1000 });
      for (const obj of listResult.objects) {
        allObjects.push({ key: obj.key, size: obj.size });
      }
      cursor = listResult.truncated ? listResult.cursor : undefined;
    } while (cursor);

    // Get all referenced storage URLs from database
    const db = await getDatabase();
    const referencedKeys = new Set<string>();

    // Card versions
    const cardVersions = await db.prepare(`
      SELECT storage_url, image_path, thumbnail_path, saved_assets
      FROM card_versions
    `).all<{
      storage_url: string;
      image_path: string | null;
      thumbnail_path: string | null;
      saved_assets: string | null;
    }>();

    for (const v of cardVersions) {
      if (v.storage_url) referencedKeys.add(v.storage_url.replace(/^r2:\/\//, ''));
      if (v.image_path) referencedKeys.add(v.image_path.replace(/^r2:\/\//, ''));
      if (v.thumbnail_path) referencedKeys.add(v.thumbnail_path.replace(/^r2:\/\//, ''));
      if (v.saved_assets) {
        const assets = JSON.parse(v.saved_assets);
        if (Array.isArray(assets)) {
          for (const a of assets) {
            const path = typeof a === 'string' ? a : a?.path;
            if (path) referencedKeys.add(path.replace(/^r2:\/\//, ''));
          }
        }
      }
    }

    // Collections
    const collections = await db.prepare(`
      SELECT storage_url, thumbnail_path FROM collections
    `).all<{ storage_url: string | null; thumbnail_path: string | null }>();

    for (const c of collections) {
      if (c.storage_url) referencedKeys.add(c.storage_url.replace(/^r2:\/\//, ''));
      if (c.thumbnail_path) referencedKeys.add(c.thumbnail_path.replace(/^r2:\/\//, ''));
    }

    // Uploads table
    const uploads = await db.prepare(`
      SELECT storage_url, path FROM uploads
    `).all<{ storage_url: string; path: string }>();

    for (const u of uploads) {
      if (u.storage_url) referencedKeys.add(u.storage_url.replace(/^r2:\/\//, ''));
      if (u.path) referencedKeys.add(u.path);
    }

    // Find orphaned objects
    const orphanedObjects: { key: string; size: number }[] = [];
    let orphanedSize = 0;

    for (const obj of allObjects) {
      // Skip pending uploads (they have their own lifecycle)
      if (obj.key.startsWith('uploads/pending/')) continue;

      if (!referencedKeys.has(obj.key)) {
        orphanedObjects.push(obj);
        orphanedSize += obj.size;
      }
    }

    // Sort by size descending, limit results
    orphanedObjects.sort((a, b) => b.size - a.size);
    const limitedOrphans = orphanedObjects.slice(0, limit);

    const stats: StorageStats = {
      totalObjects: allObjects.length,
      totalSize: allObjects.reduce((sum, o) => sum + o.size, 0),
      referencedCount: referencedKeys.size,
      orphanedCount: orphanedObjects.length,
      orphanedSize,
      orphanedKeys: limitedOrphans.map(o => o.key),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return NextResponse.json(
      { error: 'Failed to get storage stats' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/storage
 * Clean up orphaned files
 * Body: { keys: string[] } or { all: true }
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const parsed = await parseBody(request, StorageCleanupSchema);
    if ('error' in parsed) return parsed.error;
    const { keys, all } = parsed.data;

    const r2 = await getR2();
    if (!r2) {
      return NextResponse.json(
        { error: 'R2 storage not available' },
        { status: 503 }
      );
    }

    let keysToDelete: string[] = [];

    if (all) {
      // Get orphaned keys first (reuse the GET logic)
      const db = await getDatabase();
      const referencedKeys = new Set<string>();

      // Card versions
      const cardVersions = await db.prepare(`
        SELECT storage_url, image_path, thumbnail_path, saved_assets FROM card_versions
      `).all<{
        storage_url: string;
        image_path: string | null;
        thumbnail_path: string | null;
        saved_assets: string | null;
      }>();

      for (const v of cardVersions) {
        if (v.storage_url) referencedKeys.add(v.storage_url.replace(/^r2:\/\//, ''));
        if (v.image_path) referencedKeys.add(v.image_path.replace(/^r2:\/\//, ''));
        if (v.thumbnail_path) referencedKeys.add(v.thumbnail_path.replace(/^r2:\/\//, ''));
        if (v.saved_assets) {
          const assets = JSON.parse(v.saved_assets);
          if (Array.isArray(assets)) {
            for (const a of assets) {
              const path = typeof a === 'string' ? a : a?.path;
              if (path) referencedKeys.add(path.replace(/^r2:\/\//, ''));
            }
          }
        }
      }

      // Collections
      const collections = await db.prepare(`
        SELECT storage_url, thumbnail_path FROM collections
      `).all<{ storage_url: string | null; thumbnail_path: string | null }>();

      for (const c of collections) {
        if (c.storage_url) referencedKeys.add(c.storage_url.replace(/^r2:\/\//, ''));
        if (c.thumbnail_path) referencedKeys.add(c.thumbnail_path.replace(/^r2:\/\//, ''));
      }

      // Uploads
      const uploads = await db.prepare(`
        SELECT storage_url, path FROM uploads
      `).all<{ storage_url: string; path: string }>();

      for (const u of uploads) {
        if (u.storage_url) referencedKeys.add(u.storage_url.replace(/^r2:\/\//, ''));
        if (u.path) referencedKeys.add(u.path);
      }

      // List all R2 objects
      let cursor: string | undefined;
      do {
        const listResult = await r2.list({ cursor, limit: 1000 });
        for (const obj of listResult.objects) {
          // Skip pending uploads
          if (obj.key.startsWith('uploads/pending/')) continue;
          if (!referencedKeys.has(obj.key)) {
            keysToDelete.push(obj.key);
          }
        }
        cursor = listResult.truncated ? listResult.cursor : undefined;
      } while (cursor);
    } else {
      keysToDelete = keys || [];
    }

    // Delete in batches of 100
    let deleted = 0;
    let failed = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
      const batch = keysToDelete.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(key => r2.delete(key))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          deleted++;
        } else {
          failed++;
          console.error('Failed to delete key:', result.reason);
        }
      }
    }

    return NextResponse.json({
      success: true,
      deleted,
      failed,
      total: keysToDelete.length,
    });
  } catch (error) {
    console.error('Error cleaning up storage:', error);
    return NextResponse.json(
      { error: 'Failed to clean up storage' },
      { status: 500 }
    );
  }
}
