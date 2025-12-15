/**
 * POST /api/uploads/complete
 *
 * Complete a multipart upload to R2.
 * Called after all parts have been uploaded via /api/uploads/part.
 *
 * Request body (JSON):
 * - uploadId: R2 multipart upload ID
 * - key: R2 object key
 * - parts: Array of { partNumber, etag } for all uploaded parts
 *
 * Response:
 * - success: true
 * - cardId: ID of the completed card
 * - slug: Card slug for URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import { getR2 } from '@/lib/cloudflare/env';
import { getDatabase } from '@/lib/db/async-db';
import { isCloudflareRuntime } from '@/lib/db';
import { getPublicUrl } from '@/lib/storage';

const CompleteUploadSchema = z.object({
  uploadId: z.string().min(1),
  key: z.string().min(1).refine(k => k.startsWith('cards/') && !k.includes('..'), 'Invalid key'),
  parts: z.array(z.object({
    partNumber: z.number().int().min(1).max(10000),
    etag: z.string().min(1),
  })).min(1),
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

    // Get R2 binding
    const r2 = await getR2();
    if (!r2) {
      return NextResponse.json(
        { error: 'Storage not available' },
        { status: 503 }
      );
    }

    // Parse and validate body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const parsed = CompleteUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { uploadId, key, parts } = parsed.data;

    // Verify this upload belongs to the user
    const db = await getDatabase();
    const card = await db.prepare(`
      SELECT c.id, c.slug, c.uploader_id, c.head_version_id
      FROM cards c
      WHERE c.upload_id = ? AND c.processing_status = 'pending'
    `).get(uploadId) as { id: string; slug: string; uploader_id: string; head_version_id: string } | undefined;

    if (!card) {
      return NextResponse.json(
        { error: 'Upload not found or already completed' },
        { status: 404 }
      );
    }

    if (card.uploader_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Not authorized to complete this upload' },
        { status: 403 }
      );
    }

    // Sort parts by part number (required by R2)
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    // Resume and complete the multipart upload
    const multipartUpload = r2.resumeMultipartUpload(key, uploadId);

    // Complete the upload - R2 UploadedPart interface
    const uploadedParts = sortedParts.map(p => ({
      partNumber: p.partNumber,
      etag: p.etag,
    }));

    await multipartUpload.complete(uploadedParts);

    // Get the completed object to verify and get size
    const object = await r2.head(key);
    if (!object) {
      return NextResponse.json(
        { error: 'Failed to verify completed upload' },
        { status: 500 }
      );
    }

    // Build storage URL
    const storageUrl = isCloudflareRuntime()
      ? `r2://${key}`
      : `file:///${key}`;

    // Update card and version records
    const now = Math.floor(Date.now() / 1000);

    // Update card status to complete
    await db.prepare(`
      UPDATE cards
      SET processing_status = 'complete',
          upload_id = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, card.id);

    // Update version with storage URL
    await db.prepare(`
      UPDATE card_versions
      SET storage_url = ?
      WHERE id = ?
    `).run(storageUrl, card.head_version_id);

    return NextResponse.json({
      success: true,
      cardId: card.id,
      slug: card.slug,
      storageUrl: getPublicUrl(storageUrl),
      size: object.size,
    });
  } catch (error) {
    console.error('Error completing upload:', error);

    // If the multipart upload failed, we could try to abort it
    // but for now just return the error
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to complete upload' },
      { status: 500 }
    );
  }
}
