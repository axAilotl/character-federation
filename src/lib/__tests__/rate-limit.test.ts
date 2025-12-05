import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rateLimit,
  checkRateLimit,
  resetRateLimit,
  clearAllRateLimits,
  getRateLimitStats,
  getClientId,
  applyRateLimit,
  RATE_LIMITS,
  stopCleanup,
} from '../rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    clearAllRateLimits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCleanup();
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const key = 'test-key';
    const limit = 5;
    const windowMs = 60000;

    for (let i = 0; i < limit; i++) {
      const result = rateLimit(key, limit, windowMs);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(limit - i - 1);
    }
  });

  it('blocks requests over the limit', () => {
    const key = 'test-key';
    const limit = 3;
    const windowMs = 60000;

    // Use up all requests
    for (let i = 0; i < limit; i++) {
      rateLimit(key, limit, windowMs);
    }

    // Next request should be blocked
    const result = rateLimit(key, limit, windowMs);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('resets after window expires', () => {
    const key = 'test-key';
    const limit = 2;
    const windowMs = 1000; // 1 second

    // Use up all requests
    rateLimit(key, limit, windowMs);
    rateLimit(key, limit, windowMs);

    // Should be blocked
    expect(rateLimit(key, limit, windowMs).allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 100);

    // Should be allowed again
    const result = rateLimit(key, limit, windowMs);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(limit - 1);
  });

  it('implements sliding window (gradual release)', () => {
    const key = 'test-key';
    const limit = 3;
    const windowMs = 3000; // 3 seconds

    // Make 3 requests at t=0
    rateLimit(key, limit, windowMs);

    // Advance 1 second
    vi.advanceTimersByTime(1000);
    rateLimit(key, limit, windowMs);

    // Advance another second (t=2s)
    vi.advanceTimersByTime(1000);
    rateLimit(key, limit, windowMs);

    // Should be blocked at t=2s
    expect(rateLimit(key, limit, windowMs).allowed).toBe(false);

    // Advance 1.1 seconds (t=3.1s) - first request should expire
    vi.advanceTimersByTime(1100);

    // Should be allowed now (first request expired)
    expect(rateLimit(key, limit, windowMs).allowed).toBe(true);
  });

  it('handles multiple keys independently', () => {
    const limit = 2;
    const windowMs = 60000;

    // Use up key1
    rateLimit('key1', limit, windowMs);
    rateLimit('key1', limit, windowMs);
    expect(rateLimit('key1', limit, windowMs).allowed).toBe(false);

    // key2 should still be allowed
    expect(rateLimit('key2', limit, windowMs).allowed).toBe(true);
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    clearAllRateLimits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCleanup();
    vi.useRealTimers();
  });

  it('returns status without consuming request', () => {
    const key = 'test-key';
    const limit = 3;
    const windowMs = 60000;

    // Make 2 requests
    rateLimit(key, limit, windowMs);
    rateLimit(key, limit, windowMs);

    // Check should show 1 remaining
    const check = checkRateLimit(key, limit, windowMs);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(1);

    // Actually making request should still show 1 remaining after
    const result = rateLimit(key, limit, windowMs);
    expect(result.remaining).toBe(0);
  });

  it('returns full limit for unknown key', () => {
    const result = checkRateLimit('unknown', 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });
});

describe('resetRateLimit', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  afterEach(() => {
    stopCleanup();
  });

  it('resets a specific key', () => {
    const limit = 2;
    const windowMs = 60000;

    // Use up limit
    rateLimit('key1', limit, windowMs);
    rateLimit('key1', limit, windowMs);
    expect(rateLimit('key1', limit, windowMs).allowed).toBe(false);

    // Reset
    resetRateLimit('key1');

    // Should be allowed again
    expect(rateLimit('key1', limit, windowMs).allowed).toBe(true);
    expect(rateLimit('key1', limit, windowMs).remaining).toBe(0);
  });

  it('does not affect other keys', () => {
    const limit = 2;
    const windowMs = 60000;

    rateLimit('key1', limit, windowMs);
    rateLimit('key2', limit, windowMs);

    resetRateLimit('key1');

    // key1 is reset
    expect(rateLimit('key1', limit, windowMs).remaining).toBe(limit - 1);
    // key2 still has 1 request recorded
    expect(rateLimit('key2', limit, windowMs).remaining).toBe(0);
  });
});

describe('clearAllRateLimits', () => {
  afterEach(() => {
    stopCleanup();
  });

  it('clears all buckets', () => {
    rateLimit('key1', 2, 60000);
    rateLimit('key2', 2, 60000);

    expect(getRateLimitStats().bucketCount).toBe(2);

    clearAllRateLimits();

    expect(getRateLimitStats().bucketCount).toBe(0);
  });
});

describe('getRateLimitStats', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  afterEach(() => {
    stopCleanup();
  });

  it('returns correct bucket count', () => {
    rateLimit('key1', 10, 60000);
    rateLimit('key2', 10, 60000);
    rateLimit('key3', 10, 60000);

    const stats = getRateLimitStats();
    expect(stats.bucketCount).toBe(3);
  });

  it('returns correct total requests', () => {
    rateLimit('key1', 10, 60000);
    rateLimit('key1', 10, 60000);
    rateLimit('key2', 10, 60000);

    const stats = getRateLimitStats();
    expect(stats.totalRequests).toBe(3);
  });
});

describe('getClientId', () => {
  it('extracts CF-Connecting-IP header', () => {
    const headers = new Headers();
    headers.set('cf-connecting-ip', '1.2.3.4');
    headers.set('x-forwarded-for', '5.6.7.8');

    const result = getClientId({ headers });
    expect(result).toBe('1.2.3.4');
  });

  it('falls back to X-Forwarded-For', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '1.2.3.4, 5.6.7.8');

    const result = getClientId({ headers });
    expect(result).toBe('1.2.3.4');
  });

  it('falls back to X-Real-IP', () => {
    const headers = new Headers();
    headers.set('x-real-ip', '1.2.3.4');

    const result = getClientId({ headers });
    expect(result).toBe('1.2.3.4');
  });

  it('returns "unknown" when no headers', () => {
    const headers = new Headers();
    const result = getClientId({ headers });
    expect(result).toBe('unknown');
  });

  it('trims whitespace', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '  1.2.3.4  ');

    const result = getClientId({ headers });
    expect(result).toBe('1.2.3.4');
  });
});

describe('RATE_LIMITS', () => {
  it('defines expected endpoints', () => {
    expect(RATE_LIMITS.login).toBeDefined();
    expect(RATE_LIMITS.register).toBeDefined();
    expect(RATE_LIMITS.api).toBeDefined();
    expect(RATE_LIMITS.search).toBeDefined();
    expect(RATE_LIMITS.upload).toBeDefined();
    expect(RATE_LIMITS.vote).toBeDefined();
    expect(RATE_LIMITS.comment).toBeDefined();
    expect(RATE_LIMITS.report).toBeDefined();
    expect(RATE_LIMITS.download).toBeDefined();
  });

  it('login has stricter limits than api', () => {
    expect(RATE_LIMITS.login.limit).toBeLessThan(RATE_LIMITS.api.limit);
  });

  it('register has stricter limits than login', () => {
    // register: 5/10min = 0.5/min, login: 10/min
    const registerPerMin = RATE_LIMITS.register.limit / (RATE_LIMITS.register.windowMs / 60000);
    const loginPerMin = RATE_LIMITS.login.limit / (RATE_LIMITS.login.windowMs / 60000);
    expect(registerPerMin).toBeLessThan(loginPerMin);
  });
});

describe('applyRateLimit', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  afterEach(() => {
    stopCleanup();
  });

  it('uses predefined config for endpoint', () => {
    const result = applyRateLimit('client123', 'login');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMITS.login.limit - 1);
  });

  it('creates unique key per client and endpoint', () => {
    applyRateLimit('client1', 'login');
    applyRateLimit('client2', 'login');
    applyRateLimit('client1', 'register');

    const stats = getRateLimitStats();
    expect(stats.bucketCount).toBe(3);
  });
});
