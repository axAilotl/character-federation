/**
 * Thumbnail Generation (Node.js only)
 *
 * On Cloudflare Workers, thumbnails are generated on-the-fly via
 * /api/thumb/ using Cloudflare Image Transformations (cf.image).
 *
 * This module is only used for local Node.js development.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpModule: any = null;

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export type ThumbnailType = 'main' | 'asset';

const CONFIG = {
  main: { portrait: 500, landscape: 750, quality: 80 },
  asset: { portrait: 300, landscape: 450, quality: 70 },
};

/**
 * Generate a thumbnail buffer from an image buffer using Sharp
 * This is only used on Node.js - Cloudflare uses on-the-fly transformations
 */
export async function generateThumbnailBuffer(
  imageBuffer: Buffer,
  type: ThumbnailType = 'main'
): Promise<ThumbnailResult> {
  const config = CONFIG[type];

  if (!sharpModule) {
    try {
      sharpModule = (await import('sharp')).default;
    } catch {
      throw new Error('Sharp is not available in this environment');
    }
  }

  const image = sharpModule(imageBuffer);
  const metadata = await image.metadata();

  const originalWidth = metadata.width || 500;
  const originalHeight = metadata.height || 500;
  const isLandscape = originalWidth > originalHeight;

  const targetWidth = isLandscape ? config.landscape : config.portrait;
  const targetHeight = Math.round((originalHeight * targetWidth) / originalWidth);

  const buffer = await image
    .resize(targetWidth, targetHeight)
    .webp({ quality: config.quality })
    .toBuffer();

  return {
    buffer,
    width: targetWidth,
    height: targetHeight,
    originalWidth,
    originalHeight,
  };
}
