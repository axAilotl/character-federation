import sharp from 'sharp';

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export type ThumbnailType = 'main' | 'asset';

const CONFIG = {
  main: { portrait: 500, landscape: 1024, quality: 80 },
  asset: { portrait: 300, landscape: 600, quality: 70 },
};

/**
 * Generate a thumbnail buffer from an image buffer
 * Does NOT write to disk.
 */
export async function generateThumbnailBuffer(
  imageBuffer: Buffer,
  type: ThumbnailType = 'main'
): Promise<ThumbnailResult> {
  const config = CONFIG[type];

  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  const originalWidth = metadata.width || 500;
  const originalHeight = metadata.height || 500;
  const isLandscape = originalWidth > originalHeight;

  // Fixed width based on orientation
  const targetWidth = isLandscape ? config.landscape : config.portrait;
  const width = targetWidth;
  const height = Math.round((originalHeight * targetWidth) / originalWidth);

  const buffer = await image
    .resize(width, height)
    .webp({ quality: config.quality })
    .toBuffer();

  return {
    buffer,
    width,
    height,
    originalWidth,
    originalHeight,
  };
}

// Deprecated: Removed fs-based generateThumbnail
// Use generateThumbnailBuffer and store() instead.