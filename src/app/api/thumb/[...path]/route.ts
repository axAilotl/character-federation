import { NextRequest, NextResponse } from 'next/server';
import { isCloudflareRuntime } from '@/lib/db';
import { getR2, getImages, type ImagesTransformOptions } from '@/lib/cloudflare/env';

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

// Thumbnail size configurations
const THUMB_CONFIGS: Record<string, { width: number; height: number; fit: ImagesTransformOptions['fit'] }> = {
  main: { width: 500, height: 750, fit: 'cover' },
  grid: { width: 300, height: 450, fit: 'cover' },
  asset: { width: 300, height: 300, fit: 'scale-down' },
};

type ThumbType = keyof typeof THUMB_CONFIGS;

/**
 * GET /api/thumb/[...path]
 * Serve thumbnails with on-the-fly resizing
 *
 * On Cloudflare Workers: Uses IMAGES binding for transformations
 * On Node.js: Falls back to sharp
 *
 * Query params:
 * - type: 'main' | 'grid' | 'asset' (default: 'main')
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { path } = await params;
    const pathKey = path.join('/');

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const thumbType = (searchParams.get('type') || 'main') as ThumbType;

    // Get config
    const config = THUMB_CONFIGS[thumbType] || THUMB_CONFIGS.main;

    if (isCloudflareRuntime()) {
      // Cloudflare Workers: Use IMAGES binding for transformations
      const [r2, images] = await Promise.all([getR2(), getImages()]);

      if (!r2) {
        return NextResponse.json({ error: 'R2 not available' }, { status: 500 });
      }

      if (!images) {
        return NextResponse.json({ error: 'Images binding not available' }, { status: 500 });
      }

      // Get the original image from R2
      const object = await r2.get(pathKey);
      if (!object) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }

      // Get image data as ArrayBuffer
      const imageData = await object.arrayBuffer();

      try {
        // Transform the image using the IMAGES binding
        const transformed = await images
          .input(imageData)
          .transform({
            width: config.width,
            height: config.height,
            fit: config.fit,
          })
          .output({
            format: 'image/webp',
            quality: 80,
          });

        // Get the response from the transformation
        const response = transformed.response();

        // Return with proper headers
        return new NextResponse(response.body, {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Thumbnail-Type': thumbType,
          },
        });
      } catch (transformError) {
        // Image transformation failed - return original image as fallback
        // This can happen if Image Transformations isn't enabled for the zone
        console.error('Image transformation failed, returning original:', transformError);
        return new NextResponse(imageData, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType || 'image/png',
            'Cache-Control': 'public, max-age=3600',
            'X-Thumbnail-Fallback': 'true',
          },
        });
      }
    }

    // Node.js: Use sharp for transformation
    try {
      const { default: sharp } = await import('sharp');
      const fs = await import('fs');
      const nodePath = await import('path');

      const uploadsDir = process.env.UPLOADS_DIR || nodePath.join(process.cwd(), 'uploads');
      const filePath = nodePath.join(uploadsDir, pathKey);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }

      const imageBuffer = fs.readFileSync(filePath);

      // Map CF Images fit values to sharp fit values
      const fitMap: Record<string, 'cover' | 'contain' | 'fill' | 'inside' | 'outside'> = {
        'cover': 'cover',
        'contain': 'contain',
        'scale-down': 'inside',
        'crop': 'cover',
        'pad': 'contain',
      };
      const sharpFit = fitMap[config.fit || 'cover'] || 'cover';

      const transformedBuffer = await sharp(imageBuffer)
        .resize(config.width, config.height, { fit: sharpFit })
        .webp({ quality: 80 })
        .toBuffer();

      return new NextResponse(new Uint8Array(transformedBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Thumbnail-Type': thumbType,
        },
      });
    } catch {
      // Sharp not available, return original
      const fs = await import('fs');
      const nodePath = await import('path');

      const uploadsDir = process.env.UPLOADS_DIR || nodePath.join(process.cwd(), 'uploads');
      const filePath = nodePath.join(uploadsDir, pathKey);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }

      const imageBuffer = fs.readFileSync(filePath);

      return new NextResponse(new Uint8Array(imageBuffer), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    return NextResponse.json(
      { error: 'Failed to serve thumbnail' },
      { status: 500 }
    );
  }
}
