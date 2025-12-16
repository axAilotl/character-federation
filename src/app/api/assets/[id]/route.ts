import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUploadById, verifyToken } from '@/lib/db/uploads';
import { retrieve } from '@/lib/storage';
import { extname, join } from 'path';
import { createReadStream, statSync } from 'fs';
import { Readable } from 'stream';
import { parseStorageUrl } from '@/lib/storage';

const contentTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const asset = await getUploadById(id);

    if (!asset) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const session = await getSession();
    const token = request.nextUrl.searchParams.get('token');

    if (asset.visibility === 'private') {
      if (!session || (session.user.id !== asset.uploader_id && !session.user.isAdmin)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (asset.visibility === 'unlisted') {
      if (!token || !verifyToken(token, asset.access_token_hash)) {
        return NextResponse.json({ error: 'Invalid or missing token' }, { status: 403 });
      }
    }

    const ext = extname(asset.path).toLowerCase();
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Stream directly for file:// storage; otherwise fall back to buffer
    if (asset.storage_url.startsWith('file:///')) {
      const { path } = parseStorageUrl(asset.storage_url);
      const filePath = path.startsWith('/') ? path : join(process.cwd(), 'uploads', path);
      const stats = statSync(filePath);
      const etag = `"${stats.mtimeMs}-${stats.size}"`;
      const lastModified = new Date(stats.mtimeMs).toUTCString();

      const ifNoneMatch = request.headers.get('if-none-match');
      const ifModifiedSince = request.headers.get('if-modified-since');
      if ((ifNoneMatch && ifNoneMatch === etag) || (ifModifiedSince && new Date(ifModifiedSince).getTime() >= stats.mtimeMs)) {
        return new NextResponse(null, { status: 304, headers: { 'ETag': etag, 'Last-Modified': lastModified } });
      }

      const stream = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
      return new NextResponse(stream, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control':
            asset.visibility === 'private'
              ? 'private, max-age=0, no-store'
              : 'public, max-age=31536000, immutable',
          'ETag': etag,
          'Last-Modified': lastModified,
        },
      });
    }

    const buffer = await retrieve(asset.storage_url);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control':
          asset.visibility === 'private'
            ? 'private, max-age=0, no-store'
            : 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Asset fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 });
  }
}
