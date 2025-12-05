/**
 * Storage Abstraction Layer
 *
 * Provides a unified interface for storing and retrieving blobs.
 * Storage URLs use schemes to identify the backend:
 * - file:///path/to/file (local filesystem)
 * - s3://bucket/key (AWS S3 - future)
 * - ipfs://Qm... (IPFS - future)
 */

import { FileStorageDriver } from './file';
import { R2StorageDriver } from './r2';
import { isCloudflare } from '@/lib/cloudflare/env';

export interface StorageDriver {
  /**
   * Store a blob and return its storage URL
   */
  store(data: Buffer, path: string): Promise<string>;

  /**
   * Retrieve a blob by its storage URL
   */
  retrieve(url: string): Promise<Buffer>;

  /**
   * Delete a blob by its storage URL
   */
  delete(url: string): Promise<void>;

  /**
   * Check if a blob exists
   */
  exists(url: string): Promise<boolean>;

  /**
   * Get the public URL for serving (if different from storage URL)
   */
  getPublicUrl(url: string): string;
}

// Storage driver registry
const drivers: Map<string, StorageDriver> = new Map();

// Register the file driver
const fileDriver = new FileStorageDriver();
drivers.set('file', fileDriver);

// Register the R2 driver
const r2Driver = new R2StorageDriver();
drivers.set('r2', r2Driver);

/**
 * Get the appropriate driver for a storage URL
 */
function getDriver(url: string): StorageDriver {
  const scheme = url.split('://')[0];
  const driver = drivers.get(scheme);

  if (!driver) {
    throw new Error(`No storage driver registered for scheme: ${scheme}`);
  }

  return driver;
}

/**
 * Register a storage driver for a URL scheme
 */
export function registerDriver(scheme: string, driver: StorageDriver): void {
  drivers.set(scheme, driver);
}

/**
 * Store a blob using the appropriate driver (file:// or r2://)
 * Defaults to R2 in Cloudflare, File otherwise
 */
export async function store(data: Buffer, path: string): Promise<string> {
  if (isCloudflare()) {
    return r2Driver.store(data, path);
  }
  return fileDriver.store(data, path);
}

/**
 * Retrieve a blob by its storage URL
 */
export async function retrieve(url: string): Promise<Buffer> {
  const driver = getDriver(url);
  return driver.retrieve(url);
}

/**
 * Delete a blob by its storage URL
 */
export async function deleteBlob(url: string): Promise<void> {
  const driver = getDriver(url);
  return driver.delete(url);
}

/**
 * Check if a blob exists
 */
export async function exists(url: string): Promise<boolean> {
  const driver = getDriver(url);
  return driver.exists(url);
}

/**
 * Get the public URL for serving
 */
export function getPublicUrl(url: string): string {
  const driver = getDriver(url);
  return driver.getPublicUrl(url);
}

/**
 * Parse a storage URL into scheme and path
 */
export function parseStorageUrl(url: string): { scheme: string; path: string } {
  const match = url.match(/^([a-z]+):\/\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid storage URL: ${url}`);
  }
  return { scheme: match[1], path: match[2] };
}

/**
 * Build a storage URL from scheme and path
 */
export function buildStorageUrl(scheme: string, path: string): string {
  return `${scheme}://${path}`;
}
