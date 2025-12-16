/**
 * Logging infrastructure.
 * Uses console logging for both Cloudflare Workers and Node.js.
 * Winston file transport can be enabled locally by running with WINSTON=true.
 */

// Determine environment
const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
const logLevel = (typeof process !== 'undefined' && process.env?.LOG_LEVEL) || (isProduction ? 'info' : 'debug');

// Simple logger interface
interface SimpleLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  log(level: string, message: string, meta?: Record<string, unknown>): void;
  child(meta: Record<string, unknown>): SimpleLogger;
}

// Create a simple console-based logger
function createSimpleLogger(prefix = ''): SimpleLogger {
  const formatMeta = (meta?: Record<string, unknown>) =>
    meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';

  const formatPrefix = prefix ? `[${prefix}] ` : '';

  return {
    error: (msg, meta) => console.error(`${formatPrefix}[ERROR] ${msg}${formatMeta(meta)}`),
    warn: (msg, meta) => console.warn(`${formatPrefix}[WARN] ${msg}${formatMeta(meta)}`),
    info: (msg, meta) => console.info(`${formatPrefix}[INFO] ${msg}${formatMeta(meta)}`),
    debug: (msg, meta) => {
      if (logLevel === 'debug') {
        console.debug(`${formatPrefix}[DEBUG] ${msg}${formatMeta(meta)}`);
      }
    },
    log: (level, msg, meta) => console.log(`${formatPrefix}[${level.toUpperCase()}] ${msg}${formatMeta(meta)}`),
    child: (meta) => createSimpleLogger(JSON.stringify(meta)),
  };
}

// Create and export the logger
const logger: SimpleLogger = createSimpleLogger();

// Export the logger
export default logger;

// Named exports for convenience
export const log = logger;

/**
 * Create a child logger with additional context.
 * Useful for adding request ID, user ID, etc.
 */
export function createChildLogger(meta: Record<string, unknown>): SimpleLogger {
  return logger.child(meta);
}

/**
 * Log levels reference:
 * - error: Error conditions (500 errors, exceptions)
 * - warn: Warning conditions (rate limits, deprecations)
 * - info: Informational messages (request completed, user action)
 * - debug: Debug-level messages (detailed flow)
 */

// Convenience functions with request context
export interface RequestContext {
  requestId?: string;
  userId?: string;
  ip?: string;
  method?: string;
  path?: string;
}

export function logRequest(ctx: RequestContext, message: string, meta?: Record<string, unknown>): void {
  logger.info(message, { ...ctx, ...meta });
}

export function logError(ctx: RequestContext, error: Error | string, meta?: Record<string, unknown>): void {
  if (error instanceof Error) {
    logger.error(error.message, { ...ctx, ...meta, stack: error.stack });
  } else {
    logger.error(error, { ...ctx, ...meta });
  }
}

export function logWarn(ctx: RequestContext, message: string, meta?: Record<string, unknown>): void {
  logger.warn(message, { ...ctx, ...meta });
}

export function logDebug(ctx: RequestContext, message: string, meta?: Record<string, unknown>): void {
  logger.debug(message, { ...ctx, ...meta });
}

// API request logging helper
export function logApiRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  meta?: Record<string, unknown>
): void {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  logger.log(level, `${method} ${path} ${statusCode} ${durationMs}ms`, {
    method,
    path,
    statusCode,
    durationMs,
    ...meta,
  });
}

// Auth event logging
export function logAuthEvent(
  event: 'login' | 'logout' | 'register' | 'login_failed' | 'password_reset',
  userId?: string,
  meta?: Record<string, unknown>
): void {
  const level = event === 'login_failed' ? 'warn' : 'info';
  logger.log(level, `Auth event: ${event}`, { event, userId, ...meta });
}

// Rate limit logging
export function logRateLimit(
  clientId: string,
  endpoint: string,
  allowed: boolean,
  remaining: number
): void {
  if (!allowed) {
    logger.warn('Rate limit exceeded', { clientId, endpoint, remaining });
  } else if (remaining <= 5) {
    logger.debug('Rate limit approaching', { clientId, endpoint, remaining });
  }
}
