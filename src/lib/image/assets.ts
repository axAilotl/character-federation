import type { ExtractedAsset } from '@/lib/card-parser';
import { generateThumbnailBuffer } from './thumbnail';
import { store, getPublicUrl } from '@/lib/storage';
import { isCloudflare } from '@/lib/cloudflare/env';

export interface SavedAsset {
  name: string;
  type: string;
  ext: string;
  path: string;
  thumbnailPath?: string;
  width?: number;
  height?: number;
}

export interface SaveAssetsResult {
  assets: SavedAsset[];
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];

/**
 * Save extracted assets using the configured storage driver
 * Structure: assets/{cardId}/{filename}
 */
export async function saveAssets(
  cardId: string,
  extractedAssets: ExtractedAsset[]
): Promise<SaveAssetsResult> {
  if (extractedAssets.length === 0) {
    return { assets: [] };
  }

  const savedAssets: SavedAsset[] = [];

  for (let i = 0; i < extractedAssets.length; i++) {
    const asset = extractedAssets[i];

    try {
      const safeFileName = `${i}_${sanitizeFileName(asset.name)}.${asset.ext}`;
      const storagePath = `assets/${cardId}/${safeFileName}`;

      // Store asset
      await store(asset.buffer, storagePath);
      const publicUrl = getPublicUrl(isCloudflare() ? `r2://${storagePath}` : `file:///${storagePath}`);

      const savedAsset: SavedAsset = {
        name: asset.name,
        type: asset.type,
        ext: asset.ext,
        path: publicUrl,
      };

      // Generate thumbnail for images (Local only, or if sharp works)
      // On Cloudflare, we might skip this if sharp is not available,
      // OR we rely on on-demand resizing if implemented.
      // For now, try/catch around sharp.
      if (isImageFile(asset.ext)) {
        try {
          // If on Cloudflare, we skip explicit asset thumbnail generation to avoid sharp issues
          // unless we want to use CF Resizing for assets too.
          // User said "anything INSIDE a zip keep local processing enabled for".
          // But without fs/sharp, we can't do much "processing".
          // We'll rely on the original image for assets on CF for now, or use resizing URL.

          if (isCloudflare()) {
             // Use CF Resizing URL pattern for the thumbnail
             // Assuming /cdn-cgi/image/ pattern
             // This requires the domain to be set up for it.
             // We'll approximate using the publicUrl.
             savedAsset.thumbnailPath = `/cdn-cgi/image/width=300,format=webp${publicUrl}`;
             // We can't know dimensions without parsing, skipping width/height
          } else {
             // Local processing
             const thumbResult = await generateThumbnailBuffer(asset.buffer, 'asset');
             const thumbFileName = `${i}_${sanitizeFileName(asset.name)}.webp`;
             const thumbStoragePath = `assets/${cardId}/thumbnails/${thumbFileName}`;

             await store(thumbResult.buffer, thumbStoragePath);
             savedAsset.thumbnailPath = getPublicUrl(`file:///${thumbStoragePath}`);
             savedAsset.width = thumbResult.originalWidth;
             savedAsset.height = thumbResult.originalHeight;
          }

        } catch (error) {
          console.error(`Failed to generate thumbnail for asset ${asset.name}:`, error);
        }
      }

      savedAssets.push(savedAsset);
    } catch (error) {
      console.error(`Failed to save asset ${asset.name}:`, error);
    }
  }

  return { assets: savedAssets };
}

function isImageFile(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}