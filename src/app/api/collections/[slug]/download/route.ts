import { NextRequest, NextResponse } from 'next/server';
import { getCollectionBySlug, incrementCollectionDownloads } from '@/lib/db/collections';
import { retrieve } from '@/lib/storage';
import { isCloudflareRuntime } from '@/lib/db';
import { getR2 } from '@/lib/cloudflare/env';

/**
 * GET /api/collections/[slug]/download
 * Download the original .voxpkg file
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const collection = await getCollectionBySlug(slug);

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }

    // Check visibility
    if (collection.visibility === 'blocked') {
      return NextResponse.json(
        { error: 'Collection not available' },
        { status: 404 }
      );
    }

    // Retrieve the original .voxpkg file from storage
    if (isCloudflareRuntime()) {
      const r2 = await getR2();
      if (!r2) {
        return NextResponse.json(
          { error: 'Storage not available' },
          { status: 503 }
        );
      }

      const key = collection.storageUrl.replace(/^r2:\/\//, '');
      const object = await r2.get(key);
      if (!object?.body) {
        return NextResponse.json(
          { error: 'Package file not found' },
          { status: 404 }
        );
      }

      // Increment download count
      await incrementCollectionDownloads(collection.id);

      // Sanitize filename
      const safeName = collection.name
        .replace(/[^a-zA-Z0-9\s-_.]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 100);
      const filename = `${safeName}.voxpkg`;

      return new NextResponse(object.body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
          ...(typeof object.size === 'number' ? { 'Content-Length': object.size.toString() } : {}),
        },
      });
    }

    const buffer = await retrieve(collection.storageUrl);
    if (!buffer) {
      return NextResponse.json(
        { error: 'Package file not found' },
        { status: 404 }
      );
    }

    // Increment download count
    await incrementCollectionDownloads(collection.id);

    // Sanitize filename
    const safeName = collection.name
      .replace(/[^a-zA-Z0-9\s-_.]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 100);
    const filename = `${safeName}.voxpkg`;

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8 = new Uint8Array(buffer);

    return new NextResponse(uint8, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error downloading collection:', error);
    return NextResponse.json(
      { error: 'Failed to download collection' },
      { status: 500 }
    );
  }
}
