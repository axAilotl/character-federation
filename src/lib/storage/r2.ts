/**
 * R2 Storage Driver
 *
 * Stores blobs in Cloudflare R2.
 * Storage URLs: r2://bucket/key
 */

import { getR2 } from '@/lib/cloudflare/env';
import type { StorageDriver } from './index';

export class R2StorageDriver implements StorageDriver {
  /**
   * Store a blob and return its storage URL
   * @param data - The blob data
   * @param path - Relative path (key) within the bucket
   */
  async store(data: Buffer, path: string): Promise<string> {
    const r2 = await getR2();
    if (!r2) {
      throw new Error('R2 binding not available');
    }

    await r2.put(path, data);

    // Return storage URL
    return `r2://${path}`;
  }

  /**
   * Retrieve a blob by its storage URL
   */
  async retrieve(url: string): Promise<Buffer> {
    const r2 = await getR2();
    if (!r2) {
      throw new Error('R2 binding not available');
    }

    const key = this.urlToKey(url);
    const object = await r2.get(key);

    if (!object) {
      throw new Error(`Object not found: ${key}`);
    }

    // Convert body stream to Buffer
    const arrayBuffer = await object.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete a blob by its storage URL
   */
  async delete(url: string): Promise<void> {
    const r2 = await getR2();
    if (!r2) {
      throw new Error('R2 binding not available');
    }

    const key = this.urlToKey(url);
    await r2.delete(key);
  }

  /**
   * Check if a blob exists
   */
  async exists(url: string): Promise<boolean> {
    const r2 = await getR2();
    if (!r2) {
      return false;
    }

    const key = this.urlToKey(url);
    // R2 doesn't have a direct 'exists' or 'head' method exposed in all worker types bindings easily
    // but we can use get with only head if available, or just get and check null.
    // Optimized way is usually head(), but the standard binding often just has get().
    // Using get() returns null if missing.
    const object = await r2.get(key);
    return object !== null;
  }

  /**
   * Get the public URL for serving
   * We serve via the same /api/uploads/ route which should proxy R2
   */
  getPublicUrl(url: string): string {
    // r2://cards/abc123.png -> /api/uploads/cards/abc123.png
    const key = this.urlToKey(url);
    return `/api/uploads/${key}`;
  }

  /**
   * Convert a storage URL to an R2 key
   */
  private urlToKey(url: string): string {
    // r2://cards/abc123.png -> cards/abc123.png
    return url.replace(/^r2:\/\//, '');
  }
}