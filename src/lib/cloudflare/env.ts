/**
 * Cloudflare Environment Bindings
 *
 * This module provides access to Cloudflare bindings (D1, R2, etc.)
 * when running on Cloudflare Workers via OpenNext.
 */

import type { D1Database, R2Bucket, Fetcher, IncomingRequestCfProperties, ExecutionContext } from '@cloudflare/workers-types';

// Cloudflare Images binding types
export interface ImagesTransformOptions {
  width?: number;
  height?: number;
  fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
  gravity?: 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center' | { x: number; y: number };
  quality?: number;
  rotate?: 0 | 90 | 180 | 270;
  blur?: number;
  sharpen?: number;
  background?: string;
  trim?: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface ImagesOutputOptions {
  format: 'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png';
  quality?: number;
}

export interface ImagesDrawOptions {
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
  opacity?: number;
}

export interface ImagesTransformableStream {
  transform(options: ImagesTransformOptions): ImagesTransformableStream;
  draw(overlay: ImagesTransformableStream, options?: ImagesDrawOptions): ImagesTransformableStream;
  output(options: ImagesOutputOptions): Promise<{ response(): Response }>;
}

export interface ImagesBinding {
  input(source: ReadableStream | ArrayBuffer | Blob): ImagesTransformableStream;
  info(source: ReadableStream | ArrayBuffer | Blob): Promise<{
    format: string;
    fileSize: number;
    width: number;
    height: number;
  }>;
}

// Cloudflare environment bindings
export interface CloudflareEnv {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

// Type for the Cloudflare context from getCloudflareContext()
export interface CloudflareContext {
  env: CloudflareEnv;
  cf: IncomingRequestCfProperties;
  ctx: ExecutionContext;
}

// Import the official function from OpenNext
export async function getCloudflareContext(): Promise<CloudflareContext | null> {
  try {
    // Dynamic import to avoid issues during build
    const { getCloudflareContext: getCtx } = await import('@opennextjs/cloudflare');
    return getCtx() as CloudflareContext;
  } catch {
    return null;
  }
}

/**
 * Check if running in Cloudflare environment
 */
export function isCloudflare(): boolean {
  return typeof globalThis !== 'undefined' && 'caches' in globalThis && !process.env.DATABASE_PATH;
}

/**
 * Get D1 database from Cloudflare context
 * Must be called from an async context (API route, etc.)
 */
export async function getD1(): Promise<D1Database | null> {
  const ctx = await getCloudflareContext();
  return ctx?.env.DB ?? null;
}

/**
 * Get R2 bucket from Cloudflare context
 * Must be called from an async context (API route, etc.)
 */
export async function getR2(): Promise<R2Bucket | null> {
  const ctx = await getCloudflareContext();
  return ctx?.env.R2 ?? null;
}

/**
 * Get Images binding from Cloudflare context
 * Used for image transformations (resize, format conversion, etc.)
 * Must be called from an async context (API route, etc.)
 */
export async function getImages(): Promise<ImagesBinding | null> {
  const ctx = await getCloudflareContext();
  return ctx?.env.IMAGES ?? null;
}

/**
 * Get Discord credentials from environment
 * Works on both Node.js (process.env) and Cloudflare (context.env)
 */
export async function getDiscordCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  // Check process.env first (works in both Node.js and OpenNext/Cloudflare)
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // Try Cloudflare context as fallback (secrets are only available here)
  const ctx = await getCloudflareContext();
  const cfClientId = ctx?.env.DISCORD_CLIENT_ID;
  const cfClientSecret = ctx?.env.DISCORD_CLIENT_SECRET;

  if (cfClientId && cfClientSecret) {
    return {
      clientId: String(cfClientId),
      clientSecret: String(cfClientSecret),
    };
  }

  return null;
}

/**
 * Get app URL from environment
 */
export async function getAppUrl(): Promise<string> {
  const ctx = await getCloudflareContext();
  return ctx?.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}
