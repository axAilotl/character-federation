import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { store } from '@/lib/storage';
import { createUpload, generateToken, hashToken } from '@/lib/db/uploads';
import { extname } from 'path';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_VISIBILITY = ['public', 'unlisted', 'private'] as const;

type Visibility = (typeof ALLOWED_VISIBILITY)[number];

/**
 * POST /api/assets
 * Upload an asset with visibility metadata.
 * FormData: file (required), visibility ('public' | 'unlisted' | 'private')
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const visibility = (formData.get('visibility') as Visibility) || 'public';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!ALLOWED_VISIBILITY.includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Normalize path: assets/{id}{ext}
    const ext = extname(file.name).toLowerCase() || '.bin';
    const path = `assets/${crypto.randomUUID()}${ext}`;

    const storageUrl = await store(buffer, path);

    let token: string | null = null;
    let tokenHash: string | null = null;
    if (visibility === 'unlisted') {
      const generated = generateToken();
      token = generated.token;
      tokenHash = generated.hash;
    }

    const { id } = createUpload({
      storageUrl,
      path,
      uploaderId: session.user.id,
      visibility,
      accessTokenHash: tokenHash,
    });

    return NextResponse.json({
      id,
      path,
      visibility,
      token,
      storageUrl,
    });
  } catch (error) {
    console.error('Asset upload error:', error);
    return NextResponse.json({ error: 'Failed to upload asset' }, { status: 500 });
  }
}
