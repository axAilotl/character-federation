import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getCardBySlug, incrementDownloads, getCardVersionById } from '@/lib/db/cards';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const format = request.nextUrl.searchParams.get('format') || 'png';

    const card = await getCardBySlug(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    const version = card.versionId ? await getCardVersionById(card.versionId) : null;
    await incrementDownloads(card.id);

    if (format === 'json') {
      return new NextResponse(JSON.stringify(card.cardData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${card.slug}.json"`,
        },
      });
    }

    if (version?.storage_url) {
      const storagePath = version.storage_url.replace(/^file:\/\/\//, '');
      const fullStoragePath = join(process.cwd(), 'uploads', storagePath);

      if (existsSync(fullStoragePath)) {
        const fileBuffer = readFileSync(fullStoragePath);
        const ext = storagePath.split('.').pop()?.toLowerCase() || 'png';
        const contentType = ext === 'json' ? 'application/json' : 'image/png';
        const downloadExt = ext === 'json' ? 'json' : 'png';

        return new NextResponse(fileBuffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${card.slug}.${downloadExt}"`,
          },
        });
      }
    }

    if (card.imagePath) {
      const relativePath = card.imagePath.replace(/^\/?(uploads\/)?/, '');
      const fullPath = join(process.cwd(), 'uploads', relativePath);

      if (existsSync(fullPath)) {
        const imageBuffer = readFileSync(fullPath);

        return new NextResponse(imageBuffer, {
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': `attachment; filename="${card.slug}.png"`,
          },
        });
      }
    }

    return new NextResponse(JSON.stringify(card.cardData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${card.slug}.json"`,
      },
    });
  } catch (error) {
    console.error('Error downloading card:', error);
    return NextResponse.json(
      { error: 'Failed to download card' },
      { status: 500 }
    );
  }
}
