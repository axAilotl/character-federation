/**
 * KV-backed cache for Cloudflare Workers
 *
 * Provides persistent caching that survives across Worker invocations.
 * Falls back to no-op on local dev (where KV isn't available).
 */

import { getKV } from '@/lib/cloudflare';

/**
 * Cache TTL constants (in seconds)
 */
export const CACHE_TTL = {
  /** Individual card detail - 24 hours (cards rarely change) */
  CARD_DETAIL: 86400,
  /** Card listings - 1 hour (new uploads can wait, reduces KV writes) */
  CARD_LISTING: 3600,
  /** User profile - 1 hour */
  USER_PROFILE: 3600,
  /** Tags list - 1 hour (very stable) */
  TAGS: 3600,
  /** Platform stats - 15 minutes */
  STATS: 900,
} as const;

/**
 * Cache key prefixes
 */
export const CACHE_PREFIX = {
  CARD: 'card:',
  CARDS: 'cards:',
  USER: 'user:',
  TAGS: 'tags:',
  STATS: 'stats:',
} as const;

export interface CacheOptions {
  /** TTL in seconds */
  ttl?: number;
}

/**
 * Get a value from the KV cache
 * Returns null if not found or if KV is not available (local dev)
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const kv = await getKV();
    if (!kv) return null;

    const cached = await kv.get(key, 'json');
    return cached as T | null;
  } catch (error) {
    console.error(`[KV Cache] Get error for key ${key}:`, error);
    return null;
  }
}

/**
 * Set a value in the KV cache with optional TTL
 * No-op if KV is not available (local dev)
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  options?: CacheOptions
): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) return;

    await kv.put(key, JSON.stringify(value), {
      expirationTtl: options?.ttl || CACHE_TTL.CARD_DETAIL,
    });
  } catch (error) {
    console.error(`[KV Cache] Set error for key ${key}:`, error);
  }
}

/**
 * Delete a value from the KV cache
 * No-op if KV is not available (local dev)
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) return;

    await kv.delete(key);
  } catch (error) {
    console.error(`[KV Cache] Delete error for key ${key}:`, error);
  }
}

/**
 * Delete multiple keys matching a prefix
 * Note: KV list is eventually consistent, use for best-effort invalidation
 */
export async function cacheDeleteByPrefix(prefix: string): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) return;

    // List all keys with the prefix
    const listed = await kv.list({ prefix });

    // Delete each key
    await Promise.all(listed.keys.map((key) => kv.delete(key.name)));
  } catch (error) {
    console.error(`[KV Cache] Delete by prefix error for ${prefix}:`, error);
  }
}

/**
 * Create a cache key for card details
 */
export function cardCacheKey(slug: string): string {
  return `${CACHE_PREFIX.CARD}${slug}`;
}

/**
 * Create a cache key for card listings based on filter parameters
 */
export function cardListCacheKey(filters: Record<string, unknown>): string {
  // Create a deterministic hash of the filters
  const sortedKeys = Object.keys(filters).sort();
  const filterParts = sortedKeys
    .filter((k) => filters[k] !== undefined && filters[k] !== null)
    .map((k) => `${k}=${JSON.stringify(filters[k])}`);
  return `${CACHE_PREFIX.CARDS}${filterParts.join('&')}`;
}

/**
 * Create a cache key for user profile
 */
export function userCacheKey(username: string): string {
  return `${CACHE_PREFIX.USER}${username}`;
}

/**
 * Invalidate all caches related to a card
 * Call this when a card is created, updated, or deleted
 */
export async function invalidateCardCache(slug: string): Promise<void> {
  // Delete the specific card cache
  await cacheDelete(cardCacheKey(slug));

  // Delete all listing caches (they might contain this card)
  // This is a bit aggressive but ensures consistency
  await cacheDeleteByPrefix(CACHE_PREFIX.CARDS);
}
