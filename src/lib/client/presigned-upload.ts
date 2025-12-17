/**
 * Client-side presigned URL upload utilities
 *
 * Handles the flow:
 * 1. Request presigned URLs from server
 * 2. Upload files directly to R2
 * 3. Confirm upload with metadata
 */

import type { ParseResultWithAssets } from './card-parser';
import { computeContentHash } from './card-parser';

export interface UploadProgress {
  stage: 'presigning' | 'uploading' | 'confirming' | 'done' | 'error';
  percent: number;
  currentFile?: string;
  error?: string;
}

export interface PresignedUploadResult {
  success: boolean;
  slug?: string;
  isCollection?: boolean;
  error?: string;
}

interface PresignResponse {
  sessionId: string;
  urls: Record<string, { uploadUrl: string; r2Key: string }>;
  expiresAt: number;
}

interface FileDescriptor {
  key: string;
  filename: string;
  size: number;
  contentType: string;
}

type PreparedAsset = {
  name: string;
  type: string;
  ext: string;
  originalPath?: string;
  buffer: Uint8Array;
  contentType: string;
};

async function maybeTranscodeImageToWebp(asset: PreparedAsset): Promise<PreparedAsset> {
  if (asset.contentType !== 'image/png' && asset.contentType !== 'image/jpeg' && asset.contentType !== 'image/gif') {
    return asset;
  }
  if (asset.ext.toLowerCase() === 'webp') {
    return asset;
  }
  // Browser-only (tests and SSR should skip)
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return asset;
  }
  // Skip tiny images
  if (asset.buffer.byteLength < 64 * 1024) {
    return asset;
  }

  try {
    const inputBlob = new Blob([asset.buffer], { type: asset.contentType });
    const bitmap = await createImageBitmap(inputBlob);

    const maxDim = 768;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return asset;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const outBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode WebP'))),
        'image/webp',
        0.82
      );
    });

    const outBytes = new Uint8Array(await outBlob.arrayBuffer());
    return {
      ...asset,
      ext: 'webp',
      contentType: 'image/webp',
      buffer: outBytes,
    };
  } catch {
    return asset;
  }
}

/**
 * Check if presigned uploads are available
 */
export async function checkPresignedAvailable(): Promise<boolean> {
  try {
    // Make a test request to see if the endpoint is configured
    // Use application/octet-stream as it's in the allowed content types
    const response = await fetch('/api/uploads/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: crypto.randomUUID(),
        files: [{ key: 'test', filename: 'test.bin', size: 1, contentType: 'application/octet-stream' }],
      }),
    });
    // 503 means not configured, 401 means it exists but needs auth, 400 means validation failed
    // Any other status means the endpoint exists and is configured
    return response.status !== 503;
  } catch {
    return false;
  }
}

/**
 * Upload a card using presigned URLs
 */
export async function uploadWithPresignedUrls(
  file: File,
  parseResult: ParseResultWithAssets,
  visibility: 'public' | 'private' | 'unlisted',
  contentHash: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<PresignedUploadResult> {
  const sessionId = crypto.randomUUID();

  try {
    // Special case: Voxta multi-character package -> create a collection
    if (parseResult.isMultiCharPackage && parseResult.voxtaCharacters && parseResult.voxtaCharacters.length >= 2) {
      return await uploadVoxtaCollectionWithPresignedUrls(file, parseResult, visibility, onProgress);
    }

    // Stage 1: Request presigned URLs
    onProgress?.({ stage: 'presigning', percent: 0 });

    const filesToUpload: FileDescriptor[] = [];

    // Add original file
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    filesToUpload.push({
      key: 'original',
      filename: `card.${ext}`,
      size: file.size,
      contentType: getContentType(ext),
    });

    // Add icon if available
    if (parseResult.mainImage) {
      filesToUpload.push({
        key: 'icon',
        filename: 'icon.png',
        size: parseResult.mainImage.byteLength,
        contentType: 'image/png',
      });
    }

    // Prepare and (optionally) transcode extracted assets for preview
    const preparedAssets: PreparedAsset[] = [];
    if (parseResult.extractedAssets) {
      for (const asset of parseResult.extractedAssets) {
        preparedAssets.push({
          name: asset.name,
          type: asset.type,
          ext: asset.ext,
          originalPath: asset.path,
          buffer: asset.buffer,
          contentType: getContentType(asset.ext),
        });
      }
    }

    // Convert large PNG/JPEG/GIF previews to smaller WebP samples (client-side)
    const transcodedAssets: PreparedAsset[] = [];
    for (const asset of preparedAssets) {
      transcodedAssets.push(await maybeTranscodeImageToWebp(asset));
    }

    transcodedAssets.forEach((asset, index) => {
      filesToUpload.push({
        key: `asset-${index}`,
        filename: `${asset.name}.${asset.ext}`,
        size: asset.buffer.byteLength,
        contentType: asset.contentType,
      });
    });

    // Request presigned URLs
    const presignResponse = await fetch('/api/uploads/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, files: filesToUpload }),
    });

    if (!presignResponse.ok) {
      const error = await presignResponse.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to get upload URLs');
    }

    const presignData: PresignResponse = await presignResponse.json();
    onProgress?.({ stage: 'presigning', percent: 100 });

    // Stage 2: Upload files to R2
    onProgress?.({ stage: 'uploading', percent: 0 });

    const totalFiles = filesToUpload.length;
    let uploadedFiles = 0;

    // Upload original file
    onProgress?.({ stage: 'uploading', percent: 0, currentFile: file.name });
    await uploadToR2(presignData.urls.original.uploadUrl, file, getContentType(ext));
    uploadedFiles++;
    onProgress?.({ stage: 'uploading', percent: Math.round((uploadedFiles / totalFiles) * 100) });

    // Upload icon
    if (parseResult.mainImage && presignData.urls.icon) {
      onProgress?.({ stage: 'uploading', percent: Math.round((uploadedFiles / totalFiles) * 100), currentFile: 'icon.png' });
      // Convert Uint8Array to Blob (need to wrap in array as Uint8Array)
      const iconBlob = new Blob([new Uint8Array(parseResult.mainImage)], { type: 'image/png' });
      await uploadToR2(presignData.urls.icon.uploadUrl, iconBlob, 'image/png');
      uploadedFiles++;
      onProgress?.({ stage: 'uploading', percent: Math.round((uploadedFiles / totalFiles) * 100) });
    }

    // Upload assets
    for (let i = 0; i < transcodedAssets.length; i++) {
      const asset = transcodedAssets[i];
      const assetKey = `asset-${i}`;
      const assetUrl = presignData.urls[assetKey];
      if (assetUrl) {
        onProgress?.({
          stage: 'uploading',
          percent: Math.round((uploadedFiles / totalFiles) * 100),
          currentFile: `${asset.name}.${asset.ext}`,
        });
        const assetBlob = new Blob([asset.buffer], { type: asset.contentType });
        await uploadToR2(assetUrl.uploadUrl, assetBlob, asset.contentType);
        uploadedFiles++;
        onProgress?.({ stage: 'uploading', percent: Math.round((uploadedFiles / totalFiles) * 100) });
      }
    }

    // Stage 3: Confirm upload
    onProgress?.({ stage: 'confirming', percent: 0 });

    const { card } = parseResult;
    const confirmBody = {
      sessionId,
      metadata: {
        name: card.name,
        description: card.description || '',
        creator: card.creator || '',
        creatorNotes: card.creatorNotes || '',
        specVersion: card.specVersion,
        sourceFormat: card.sourceFormat,
        tokens: card.tokens,
        metadata: card.metadata,
        tags: card.tags,
        contentHash,
        cardData: JSON.stringify(card.raw),
      },
      files: {
        original: { r2Key: presignData.urls.original.r2Key },
        ...(presignData.urls.icon && { icon: { r2Key: presignData.urls.icon.r2Key } }),
        assets: transcodedAssets
          .map((asset, i) => ({
            r2Key: presignData.urls[`asset-${i}`]?.r2Key || '',
            name: asset.name,
            type: asset.type,
            ext: asset.ext,
            originalPath: asset.originalPath || '',
          }))
          .filter(a => a.r2Key) || [],
      },
      visibility,
    };

    const confirmResponse = await fetch('/api/uploads/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(confirmBody),
    });

    if (!confirmResponse.ok) {
      const error = await confirmResponse.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to confirm upload');
    }

    const confirmData = await confirmResponse.json();
    onProgress?.({ stage: 'done', percent: 100 });

    return {
      success: true,
      slug: confirmData.data.slug,
      isCollection: confirmData.type === 'collection',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    onProgress?.({ stage: 'error', percent: 0, error: message });
    return {
      success: false,
      error: message,
    };
  }
}

async function uploadVoxtaCollectionWithPresignedUrls(
  file: File,
  parseResult: ParseResultWithAssets,
  visibility: 'public' | 'private' | 'unlisted',
  onProgress?: (progress: UploadProgress) => void
): Promise<PresignedUploadResult> {
  const sessionId = crypto.randomUUID();

  const characters = parseResult.voxtaCharacters || [];
  if (characters.length < 2) {
    throw new Error('Voxta collection upload requires 2+ characters');
  }

  // Stage 1: Presign
  onProgress?.({ stage: 'presigning', percent: 0 });

  const ext = file.name.split('.').pop()?.toLowerCase() || 'voxpkg';

  const filesToUpload: FileDescriptor[] = [
    {
      key: 'original',
      filename: `collection.${ext}`,
      size: file.size,
      contentType: getContentType(ext),
    },
  ];

  for (const c of characters) {
    if (!c.thumbnail) {
      throw new Error(`Missing thumbnail for character ${c.id}`);
    }
    filesToUpload.push({
      key: `thumb-${c.id}`,
      filename: `thumb-${c.id}.png`,
      size: c.thumbnail.byteLength,
      contentType: 'image/png',
    });
  }

  const presignResponse = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, files: filesToUpload }),
  });

  if (!presignResponse.ok) {
    const error = await presignResponse.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to get upload URLs');
  }

  const presignData: PresignResponse = await presignResponse.json();
  onProgress?.({ stage: 'presigning', percent: 100 });

  // Stage 2: Upload to R2
  onProgress?.({ stage: 'uploading', percent: 0 });

  const totalFiles = filesToUpload.length;
  let uploadedFiles = 0;

  onProgress?.({ stage: 'uploading', percent: 0, currentFile: file.name });
  await uploadToR2(presignData.urls.original.uploadUrl, file, getContentType(ext));
  uploadedFiles++;

  for (const c of characters) {
    const urlKey = `thumb-${c.id}`;
    const urlInfo = presignData.urls[urlKey];
    if (!c.thumbnail || !urlInfo) continue;

    onProgress?.({
      stage: 'uploading',
      percent: Math.round((uploadedFiles / totalFiles) * 100),
      currentFile: `thumb-${c.id}.png`,
    });

    const blob = new Blob([new Uint8Array(c.thumbnail)], { type: 'image/png' });
    await uploadToR2(urlInfo.uploadUrl, blob, 'image/png');
    uploadedFiles++;
  }

  onProgress?.({ stage: 'uploading', percent: 100 });

  // Stage 3: Confirm
  onProgress?.({ stage: 'confirming', percent: 0 });

  const pkg = (parseResult.voxtaPackageJson || {}) as Record<string, any>;
  const collection = {
    name: (pkg.Name as string) || parseResult.packageName || `${characters.length} Characters`,
    description: (pkg.Description as string) || '',
    creator: (pkg.Creator as string) || '',
    explicitContent: !!pkg.ExplicitContent,
    packageId: (pkg.Id as string) || null,
    packageVersion: (pkg.Version as string) || null,
    entryResourceKind: (pkg.EntryResource?.Kind as number) ?? null,
    entryResourceId: (pkg.EntryResource?.Id as string) ?? null,
    thumbnailResourceKind: (pkg.ThumbnailResource?.Kind as number) ?? null,
    thumbnailResourceId: (pkg.ThumbnailResource?.Id as string) ?? null,
    dateCreated: (pkg.DateCreated as string) || null,
    dateModified: (pkg.DateModified as string) || null,
    thumbnailCharacterId: (pkg.ThumbnailResource?.Id as string) ?? null,
  };

  const thumbnails = characters.map((c) => ({
    characterId: c.id,
    r2Key: presignData.urls[`thumb-${c.id}`]!.r2Key,
  }));

  const cards = await Promise.all(
    characters.map(async (c) => {
      const encoder = new TextEncoder();
      const cardData = JSON.stringify(c.card.raw);
      const contentHash = await computeContentHash(encoder.encode(cardData));

      return {
        characterId: c.id,
        metadata: {
          name: c.card.name,
          description: c.card.description || '',
          creator: c.card.creator || '',
          creatorNotes: c.card.creatorNotes || '',
          specVersion: c.card.specVersion,
          sourceFormat: c.card.sourceFormat,
          tokens: c.card.tokens,
          metadata: c.card.metadata,
          tags: c.card.tags,
          contentHash,
          cardData,
        },
      };
    })
  );

  const confirmResponse = await fetch('/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'collection',
      sessionId,
      collection,
      files: {
        original: { r2Key: presignData.urls.original.r2Key },
        thumbnails,
      },
      cards,
      visibility,
    }),
  });

  if (!confirmResponse.ok) {
    const error = await confirmResponse.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to confirm upload');
  }

  const confirmData = await confirmResponse.json();
  onProgress?.({ stage: 'done', percent: 100 });

  return {
    success: true,
    slug: confirmData.data.slug,
    isCollection: true,
  };
}

/**
 * Upload a file/blob directly to R2 using a presigned URL
 */
async function uploadToR2(url: string, data: File | Blob, contentType: string): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: data,
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed: ${response.status}`);
  }
}

/**
 * Get content type from file extension
 */
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    json: 'application/json',
    charx: 'application/zip',
    voxpkg: 'application/zip',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}
