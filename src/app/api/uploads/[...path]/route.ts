import { NextRequest, NextResponse } from 'next/server';
import { safeResolveUploadPath } from '../utils';
import { getUploadByPath, verifyToken } from '@/lib/db/uploads';
import { getSession } from '@/lib/auth';
import { isCloudflareRuntime } from '@/lib/db';
import { getR2 } from '@/lib/cloudflare/env';

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

/**
 * GET /api/uploads/[...path]
 * Serve uploaded files from local filesystem or R2
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { path } = await params;
    const pathKey = path.join('/');

    // Determine content type
    const ext = path[path.length - 1]?.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      json: 'application/json',
    };
    const contentType = contentTypes[ext || ''] || 'application/octet-stream';

    // Public paths that don't require metadata lookup (processed images)
    // thumbs/ - main card thumbnails
    // thumbs/assets/ - asset thumbnails
    // images/ - processed embedded images
    // assets/ - extracted package assets (CharX, Voxta, etc.)
    const isPublicPath = pathKey.startsWith('thumbs/') || pathKey.startsWith('images/') || pathKey.startsWith('assets/');

    // Visibility enforcement - ALWAYS require metadata on Cloudflare/R2 (fail closed)
    // EXCEPT for public processed image paths
    const meta = isPublicPath ? null : await getUploadByPath(pathKey);
    const session = await getSession();
    const token = request.nextUrl.searchParams.get('token');

    // On Cloudflare, require metadata to exist (fail closed)
    if (isCloudflareRuntime()) {
      // Validate path format to prevent path traversal
      if (pathKey.includes('..') || pathKey.startsWith('/')) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      // CRITICAL: Fail closed - require metadata for R2 access
      // Public paths (thumbs/, images/) are allowed without metadata
      if (!meta && !isPublicPath) {
        console.warn(`[Uploads] Access denied - no metadata for R2 path: ${pathKey}`);
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Enforce visibility based on metadata (if not a public path)
      if (meta) {
        if (meta.visibility === 'private') {
          if (!session || (session.user.id !== meta.uploader_id && !session.user.isAdmin)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
          }
        } else if (meta.visibility === 'unlisted') {
          if (!token || !verifyToken(token, meta.access_token_hash)) {
            return NextResponse.json({ error: 'Invalid or missing token' }, { status: 403 });
          }
        }
      }

      const r2 = await getR2();
      if (!r2) {
        return NextResponse.json({ error: 'R2 not available' }, { status: 500 });
      }

      const object = await r2.get(pathKey);
      if (!object) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const data = await object.arrayBuffer();

      return new NextResponse(data, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': meta?.visibility === 'private'
            ? 'private, max-age=0, no-store'
            : 'public, max-age=31536000, immutable',
          'Content-Length': data.byteLength.toString(),
        },
      });
    }

    // Local development: enforce visibility if metadata exists
    if (meta) {
      if (meta.visibility === 'private') {
        if (!session || (session.user.id !== meta.uploader_id && !session.user.isAdmin)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      } else if (meta.visibility === 'unlisted') {
        if (!token || !verifyToken(token, meta.access_token_hash)) {
          return NextResponse.json({ error: 'Invalid or missing token' }, { status: 403 });
        }
      }
    }

    // Local: use filesystem
    const { existsSync, statSync, readFileSync } = await import('fs');

    const resolvedPath = safeResolveUploadPath(path);
    if (!resolvedPath) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stats = statSync(resolvedPath);
    const etag = `"${stats.mtimeMs}-${stats.size}"`;
    const lastModified = new Date(stats.mtimeMs).toUTCString();

    // Conditional request handling
    const ifNoneMatch = request.headers.get('if-none-match');
    const ifModifiedSince = request.headers.get('if-modified-since');
    if ((ifNoneMatch && ifNoneMatch === etag) || (ifModifiedSince && new Date(ifModifiedSince).getTime() >= stats.mtimeMs)) {
      return new NextResponse(null, { status: 304, headers: { 'ETag': etag, 'Last-Modified': lastModified } });
    }

    // Read file into buffer (local dev only, files are typically small)
    const fileBuffer = readFileSync(resolvedPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': meta && meta.visibility === 'private'
          ? 'private, max-age=0, no-store'
          : 'public, max-age=31536000, immutable',
        'Content-Length': fileBuffer.length.toString(),
        'ETag': etag,
        'Last-Modified': lastModified,
      },
    });
  } catch (error) {
    console.error('Error serving upload:', error);
    return NextResponse.json(
      { error: 'Failed to serve file' },
      { status: 500 }
    );
  }
}
