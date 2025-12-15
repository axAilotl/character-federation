/**
 * R2 Presigned URL Utilities
 *
 * Generates presigned URLs for direct client uploads to R2.
 * Uses aws4fetch which is Cloudflare Workers compatible (no Node.js fs deps).
 */

import { AwsClient } from 'aws4fetch';
import { getR2Credentials } from '@/lib/cloudflare/env';

// R2 bucket name (should match wrangler.toml)
const R2_BUCKET_NAME = 'cardshub-uploads';

// Presigned URL expiration (1 hour)
const PRESIGN_EXPIRY_SECONDS = 3600;

// Max file size for uploads (50MB - Cloudflare limit)
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

// Allowed content types
export const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/json',
  'application/zip', // CharX and Voxta packages
  'application/octet-stream', // Generic binary
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);

/**
 * File descriptor for presigned URL generation
 */
export interface PresignFileDescriptor {
  /** Unique key for this file in the session (e.g., "original", "icon", "asset-0") */
  key: string;
  /** Original filename */
  filename: string;
  /** File size in bytes */
  size: number;
  /** Content type */
  contentType: string;
}

/**
 * Result of presigned URL generation
 */
export interface PresignedUrlResult {
  /** The key used in the request */
  key: string;
  /** Presigned PUT URL for direct upload */
  uploadUrl: string;
  /** R2 object key where the file will be stored */
  r2Key: string;
}

/**
 * Get or create aws4fetch client for R2
 */
let awsClient: AwsClient | null = null;
let r2BaseUrl: string | null = null;

async function getAwsClient(): Promise<{ client: AwsClient; baseUrl: string } | null> {
  if (awsClient && r2BaseUrl) {
    return { client: awsClient, baseUrl: r2BaseUrl };
  }

  const creds = await getR2Credentials();
  if (!creds) return null;

  awsClient = new AwsClient({
    service: 's3',
    region: 'auto',
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
  });

  r2BaseUrl = `https://${creds.accountId}.r2.cloudflarestorage.com`;

  return { client: awsClient, baseUrl: r2BaseUrl };
}

/**
 * Generate a presigned PUT URL for uploading a file to R2
 *
 * @param sessionId - Upload session ID (groups related files)
 * @param file - File descriptor
 * @returns Presigned URL result or null if credentials not available
 */
export async function generatePresignedPutUrl(
  sessionId: string,
  file: PresignFileDescriptor
): Promise<PresignedUrlResult | null> {
  const aws = await getAwsClient();
  if (!aws) return null;

  // Validate content type
  if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
    throw new Error(`Content type not allowed: ${file.contentType}`);
  }

  // Validate file size
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error(`File too large: ${file.size} bytes (max ${MAX_UPLOAD_SIZE})`);
  }

  // Generate R2 key: uploads/pending/{sessionId}/{key}/{filename}
  const r2Key = `uploads/pending/${sessionId}/${file.key}/${file.filename}`;

  // Build the URL with expiry query param
  const url = `${aws.baseUrl}/${R2_BUCKET_NAME}/${r2Key}?X-Amz-Expires=${PRESIGN_EXPIRY_SECONDS}`;

  // Sign the request for PUT
  const signedRequest = await aws.client.sign(
    new Request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': file.size.toString(),
      },
    }),
    { aws: { signQuery: true } }
  );

  return {
    key: file.key,
    uploadUrl: signedRequest.url.toString(),
    r2Key,
  };
}

/**
 * Generate presigned URLs for multiple files (batch)
 *
 * @param sessionId - Upload session ID
 * @param files - Array of file descriptors
 * @returns Map of key -> presigned URL result
 */
export async function generatePresignedPutUrls(
  sessionId: string,
  files: PresignFileDescriptor[]
): Promise<Map<string, PresignedUrlResult>> {
  const results = new Map<string, PresignedUrlResult>();

  // Generate URLs in parallel
  const promises = files.map(async (file) => {
    const result = await generatePresignedPutUrl(sessionId, file);
    if (result) {
      results.set(file.key, result);
    }
  });

  await Promise.all(promises);

  return results;
}

/**
 * Check if presigned URL generation is available
 * (requires R2 API credentials)
 */
export async function isPresignAvailable(): Promise<boolean> {
  const creds = await getR2Credentials();
  return creds !== null;
}

/**
 * Move a file from pending to permanent location after confirmation
 * Uses the R2 binding (not S3 API) since we're in Workers context
 */
export async function movePendingToPermanent(
  pendingKey: string,
  permanentKey: string
): Promise<void> {
  // This will be implemented using the R2 binding
  // For now, we'll copy + delete since R2 doesn't have a native move operation
  const { getR2 } = await import('@/lib/cloudflare/env');
  const r2 = await getR2();
  if (!r2) throw new Error('R2 binding not available');

  // Get the pending object
  const object = await r2.get(pendingKey);
  if (!object) throw new Error(`Pending file not found: ${pendingKey}`);

  // Copy to permanent location
  const data = await object.arrayBuffer();
  await r2.put(permanentKey, data, {
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  });

  // Delete the pending file
  await r2.delete(pendingKey);
}
