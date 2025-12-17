/**
 * POST /api/uploads/presign
 *
 * Generate presigned URLs for direct R2 uploads.
 * Requires authentication.
 *
 * Request body:
 * {
 *   sessionId: string,      // Client-generated upload session ID
 *   files: Array<{
 *     key: string,          // Unique key (e.g., "original", "icon", "asset-0")
 *     filename: string,     // Original filename
 *     size: number,         // Size in bytes
 *     contentType: string   // MIME type
 *   }>
 * }
 *
 * Response:
 * {
 *   sessionId: string,
 *   urls: {
 *     [key]: { uploadUrl: string, r2Key: string }
 *   },
 *   expiresAt: number  // Unix timestamp when URLs expire
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import {
  generatePresignedPutUrls,
  isPresignAvailable,
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_SIZE,
  type PresignFileDescriptor,
} from '@/lib/storage/presign';

// Validation schema
const FileDescriptorSchema = z.object({
  key: z.string().min(1).max(50),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_SIZE),
  contentType: z.string().refine(
    (ct) => ALLOWED_CONTENT_TYPES.has(ct),
    { message: 'Content type not allowed' }
  ),
});

const PresignRequestSchema = z.object({
  sessionId: z.string().uuid(),
  files: z.array(FileDescriptorSchema).min(1).max(250),
});

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if uploads are enabled
    const { isUploadsEnabled } = await import('@/lib/db/settings');
    const uploadsAllowed = await isUploadsEnabled();
    if (!uploadsAllowed) {
      return NextResponse.json(
        { error: 'Card uploads are currently disabled' },
        { status: 403 }
      );
    }

    // Check if presigned URLs are available
    const available = await isPresignAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Presigned uploads not configured. Please use standard upload.' },
        { status: 503 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = PresignRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sessionId, files } = parsed.data;

    // Check total size doesn't exceed reasonable limit
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1GB total per session
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        { error: `Total upload size exceeds limit (${Math.round(MAX_TOTAL_SIZE / 1024 / 1024)}MB)` },
        { status: 400 }
      );
    }

    // Generate presigned URLs
    const fileDescriptors: PresignFileDescriptor[] = files.map((f) => ({
      key: f.key,
      filename: f.filename,
      size: f.size,
      contentType: f.contentType,
    }));

    const urlMap = await generatePresignedPutUrls(sessionId, fileDescriptors);

    // Convert map to object for JSON response
    const urls: Record<string, { uploadUrl: string; r2Key: string }> = {};
    for (const [key, result] of urlMap) {
      urls[key] = {
        uploadUrl: result.uploadUrl,
        r2Key: result.r2Key,
      };
    }

    // Calculate expiration (1 hour from now)
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    return NextResponse.json({
      sessionId,
      urls,
      expiresAt,
    });
  } catch (error) {
    console.error('Error generating presigned URLs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate upload URLs' },
      { status: 500 }
    );
  }
}
