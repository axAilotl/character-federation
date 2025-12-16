/**
 * Client-side chunked upload for large files (>75MB)
 *
 * Uses R2 multipart upload via Worker:
 * 1. POST /api/cards/pending - Create card with metadata + thumbnail, get uploadId
 * 2. PUT /api/uploads/part - Upload each chunk
 * 3. POST /api/uploads/complete - Finalize the upload
 */

import type { ParseResultWithAssets } from './card-parser';

// Chunk size (50MB - safe for Workers memory)
const CHUNK_SIZE = 50 * 1024 * 1024;

// Threshold for using chunked uploads (40MB to avoid CF 50MB limit)
// Use chunked upload for files >=40MB (Cloudflare limit is 50MB, leave headroom for metadata)
export const CHUNKED_UPLOAD_THRESHOLD = 40 * 1024 * 1024;

export interface ChunkedUploadProgress {
  stage: 'creating' | 'uploading' | 'completing' | 'done' | 'error';
  percent: number;
  currentChunk?: number;
  totalChunks?: number;
  error?: string;
}

export interface ChunkedUploadResult {
  success: boolean;
  cardId?: string;
  slug?: string;
  error?: string;
}

/**
 * Upload a large file using chunked multipart upload
 */
export async function uploadChunked(
  file: File,
  parseResult: ParseResultWithAssets,
  visibility: 'public' | 'private' | 'unlisted',
  contentHash: string,
  onProgress: (progress: ChunkedUploadProgress) => void
): Promise<ChunkedUploadResult> {
  try {
    onProgress({ stage: 'creating', percent: 0 });

    // Prepare metadata for pending card creation
    const { card, mainImage } = parseResult;

    // Count assets from manifest (CharX/Voxta packages)
    const assetsCount = parseResult.extractedAssets?.length || 0;
    const hasAssets = assetsCount > 0;

    const metadata = {
      name: card.name,
      description: card.description || '',
      creator: card.creator || '',
      creatorNotes: card.creatorNotes || '',
      specVersion: card.specVersion,
      sourceFormat: card.sourceFormat,
      tokens: card.tokens,
      metadata: {
        ...card.metadata,
        hasAssets,
        assetsCount,
      },
      tags: card.tags,
      contentHash,
      cardData: JSON.stringify(card.raw),
      fileSize: file.size,
      fileExtension: getFileExtension(file.name),
      // Asset manifest for future processing (if CharX/Voxta with assets)
      assetManifest: parseResult.extractedAssets?.map((a) => ({
        name: a.name,
        path: a.path,
        size: a.buffer.byteLength,
        type: a.type,
      })),
    };

    // Create FormData with metadata and optional thumbnail
    const formData = new FormData();
    formData.append('metadata', JSON.stringify(metadata));
    formData.append('visibility', visibility);

    // Add thumbnail if we have a main image
    if (mainImage) {
      const thumbBlob = new Blob([new Uint8Array(mainImage)], { type: 'image/png' });
      formData.append('thumbnail', thumbBlob, 'thumbnail.png');
    }

    // Step 1: Create pending card
    const pendingResponse = await fetch('/api/cards/pending', {
      method: 'POST',
      body: formData,
    });

    if (!pendingResponse.ok) {
      const error = await pendingResponse.json().catch(() => ({ error: 'Failed to create pending card' }));
      throw new Error(error.error || 'Failed to create pending card');
    }

    const { cardId, slug, uploadId, r2Key } = await pendingResponse.json();

    onProgress({ stage: 'creating', percent: 10 });

    // Step 2: Upload file in chunks
    const fileBuffer = await file.arrayBuffer();
    const totalSize = fileBuffer.byteLength;
    const chunks = Math.ceil(totalSize / CHUNK_SIZE);
    const parts: { partNumber: number; etag: string }[] = [];

    for (let i = 0; i < chunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunk = fileBuffer.slice(start, end);
      const partNumber = i + 1;

      onProgress({
        stage: 'uploading',
        percent: 10 + Math.round((i / chunks) * 80),
        currentChunk: partNumber,
        totalChunks: chunks,
      });

      // Upload this chunk
      const partResponse = await fetch(
        `/api/uploads/part?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}&key=${encodeURIComponent(r2Key)}`,
        {
          method: 'PUT',
          body: chunk,
          headers: {
            'Content-Type': 'application/octet-stream',
          },
        }
      );

      if (!partResponse.ok) {
        const error = await partResponse.json().catch(() => ({ error: 'Failed to upload chunk' }));
        throw new Error(error.error || `Failed to upload chunk ${partNumber}`);
      }

      const partResult = await partResponse.json();
      parts.push({
        partNumber: partResult.partNumber,
        etag: partResult.etag,
      });
    }

    onProgress({ stage: 'completing', percent: 90 });

    // Step 3: Complete the upload
    const completeResponse = await fetch('/api/uploads/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uploadId,
        key: r2Key,
        parts,
      }),
    });

    if (!completeResponse.ok) {
      const error = await completeResponse.json().catch(() => ({ error: 'Failed to complete upload' }));
      throw new Error(error.error || 'Failed to complete upload');
    }

    onProgress({ stage: 'done', percent: 100 });

    return {
      success: true,
      cardId,
      slug,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    onProgress({ stage: 'error', percent: 0, error: message });
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Get file extension from filename
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot);
}

/**
 * Check if a file should use chunked upload
 */
export function shouldUseChunkedUpload(fileSize: number): boolean {
  return fileSize >= CHUNKED_UPLOAD_THRESHOLD;
}
