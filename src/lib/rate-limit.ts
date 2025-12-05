/**
 * Sliding window rate limiter with configurable limits per endpoint.
 * Suitable for single-node dev/preview; replace with Redis/KV for multi-node.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

// Sliding window bucket: stores timestamps of requests
type SlidingBucket = {
  timestamps: number[];
  windowMs: number;
};

const buckets = new Map<string, SlidingBucket>();

// Periodic cleanup of expired buckets (every 5 minutes)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      // Remove timestamps older than window
      bucket.timestamps = bucket.timestamps.filter(ts => ts > now - bucket.windowMs);
      // Remove empty buckets
      if (bucket.timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

/**
 * Sliding window rate limiter.
 * More accurate than fixed window - prevents burst at window boundaries.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  startCleanup();

  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { timestamps: [], windowMs };
    buckets.set(key, bucket);
  }

  // Clean old timestamps outside current window
  bucket.timestamps = bucket.timestamps.filter(ts => ts > now - windowMs);

  const count = bucket.timestamps.length;
  const resetAt = count > 0 ? bucket.timestamps[0] + windowMs : now + windowMs;

  if (count >= limit) {
    const oldestTimestamp = bucket.timestamps[0];
    const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(1, retryAfter),
    };
  }

  // Add current request timestamp
  bucket.timestamps.push(now);

  return {
    allowed: true,
    remaining: limit - bucket.timestamps.length,
    resetAt,
  };
}

/**
 * Check rate limit without consuming a request.
 * Useful for preflight checks.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: now + windowMs,
    };
  }

  // Clean old timestamps
  const validTimestamps = bucket.timestamps.filter(ts => ts > now - windowMs);
  const count = validTimestamps.length;
  const resetAt = count > 0 ? validTimestamps[0] + windowMs : now + windowMs;

  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfter: count >= limit ? Math.ceil((validTimestamps[0] + windowMs - now) / 1000) : undefined,
  };
}

/**
 * Reset rate limit for a key.
 * Useful for testing or admin overrides.
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Clear all rate limits.
 * Useful for testing.
 */
export function clearAllRateLimits(): void {
  buckets.clear();
}

/**
 * Get current bucket count for debugging/monitoring.
 */
export function getRateLimitStats(): { bucketCount: number; totalRequests: number } {
  let totalRequests = 0;
  for (const bucket of buckets.values()) {
    totalRequests += bucket.timestamps.length;
  }
  return { bucketCount: buckets.size, totalRequests };
}

/**
 * Extract client identifier from request headers.
 * Prefers CF-Connecting-IP (Cloudflare) > X-Forwarded-For > X-Real-IP
 */
export function getClientId(request: Request | { headers: Headers }): string {
  const headers = request instanceof Request ? request.headers : request.headers;

  // Cloudflare's connecting IP (most reliable when behind CF)
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // X-Forwarded-For (first IP in chain is client)
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  // X-Real-IP (some proxies use this)
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}

// Predefined rate limit configurations for different endpoints
export const RATE_LIMITS = {
  // Auth endpoints - stricter limits
  login: { limit: 10, windowMs: 60_000 } as RateLimitConfig,           // 10/min
  register: { limit: 5, windowMs: 10 * 60_000 } as RateLimitConfig,    // 5/10min
  passwordReset: { limit: 3, windowMs: 60 * 60_000 } as RateLimitConfig, // 3/hour

  // API endpoints - standard limits
  api: { limit: 100, windowMs: 60_000 } as RateLimitConfig,            // 100/min
  search: { limit: 30, windowMs: 60_000 } as RateLimitConfig,          // 30/min
  upload: { limit: 10, windowMs: 60_000 } as RateLimitConfig,          // 10/min

  // Interaction endpoints
  vote: { limit: 60, windowMs: 60_000 } as RateLimitConfig,            // 60/min
  comment: { limit: 20, windowMs: 60_000 } as RateLimitConfig,         // 20/min
  report: { limit: 10, windowMs: 60 * 60_000 } as RateLimitConfig,     // 10/hour

  // Download - generous but tracked
  download: { limit: 100, windowMs: 60_000 } as RateLimitConfig,       // 100/min
} as const;

/**
 * Apply rate limit using predefined configuration.
 */
export function applyRateLimit(
  clientId: string,
  endpoint: keyof typeof RATE_LIMITS
): RateLimitResult {
  const config = RATE_LIMITS[endpoint];
  return rateLimit(`${endpoint}:${clientId}`, config.limit, config.windowMs);
}

// For testing: stop cleanup interval
export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
