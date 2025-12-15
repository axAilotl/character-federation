/**
 * PUT /api/uploads/part
 *
 * Upload a single part of a multipart upload to R2.
 * Called repeatedly by client for each chunk of a large file.
 *
 * Query params:
 * - uploadId: R2 multipart upload ID (from /api/cards/pending)
 * - partNumber: Part number (1-indexed, max 10000)
 * - key: R2 object key
 *
 * Request body: Binary chunk data (max 100MB per chunk, recommended 50MB)
 *
 * Response:
 * - etag: ETag of uploaded part (needed for complete)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getR2 } from '@/lib/cloudflare/env';
import { getDatabase } from '@/lib/db/async-db';

// Max part size (100MB - R2 limit, but we recommend 50MB chunks)
const MAX_PART_SIZE = 100 * 1024 * 1024;

// Min part size (5MB - R2 minimum except for last part)
const MIN_PART_SIZE = 5 * 1024 * 1024;

export async function PUT(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get R2 binding
    const r2 = await getR2();
    if (!r2) {
      return NextResponse.json(
        { error: 'Storage not available' },
        { status: 503 }
      );
    }

    // Parse query params
    const { searchParams } = request.nextUrl;
    const uploadId = searchParams.get('uploadId');
    const partNumberStr = searchParams.get('partNumber');
    const key = searchParams.get('key');

    if (!uploadId || !partNumberStr || !key) {
      return NextResponse.json(
        { error: 'Missing required params: uploadId, partNumber, key' },
        { status: 400 }
      );
    }

    const partNumber = parseInt(partNumberStr, 10);
    if (isNaN(partNumber) || partNumber < 1 || partNumber > 10000) {
      return NextResponse.json(
        { error: 'Invalid part number (must be 1-10000)' },
        { status: 400 }
      );
    }

    // Validate key format (must be cards/{cardId}.{ext})
    if (!key.startsWith('cards/') || key.includes('..')) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    // Verify this upload belongs to the user
    const db = await getDatabase();
    const card = await db.prepare(`
      SELECT id, uploader_id FROM cards
      WHERE upload_id = ? AND processing_status = 'pending'
    `).get(uploadId) as { id: string; uploader_id: string } | undefined;

    if (!card) {
      return NextResponse.json(
        { error: 'Upload not found or already completed' },
        { status: 404 }
      );
    }

    if (card.uploader_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Not authorized to upload to this card' },
        { status: 403 }
      );
    }

    // Get chunk data
    const arrayBuffer = await request.arrayBuffer();
    const chunkSize = arrayBuffer.byteLength;

    if (chunkSize > MAX_PART_SIZE) {
      return NextResponse.json(
        { error: `Part too large: ${chunkSize} bytes (max ${MAX_PART_SIZE})` },
        { status: 400 }
      );
    }

    // Note: We don't enforce MIN_PART_SIZE here because the last part can be smaller
    // R2 will reject if a non-final part is too small when completing

    // Resume the multipart upload and upload this part
    const multipartUpload = r2.resumeMultipartUpload(key, uploadId);

    const uploadedPart = await multipartUpload.uploadPart(
      partNumber,
      arrayBuffer
    );

    return NextResponse.json({
      success: true,
      partNumber,
      etag: uploadedPart.etag,
      size: chunkSize,
    });
  } catch (error) {
    console.error('Error uploading part:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload part' },
      { status: 500 }
    );
  }
}
