import { NextRequest, NextResponse } from 'next/server';
import { getCardBySlug, incrementDownloads, getCardVersionById } from '@/lib/db/cards';
import { isCloudflareRuntime } from '@/lib/db';
import { getR2 } from '@/lib/cloudflare/env';
import { buildCardExportFilename } from '@/lib/utils';
import { embedIntoPNG } from '@character-foundry/character-foundry/png';
import { toUint8Array } from '@character-foundry/character-foundry/core';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import {
  CCv2WrappedSchema,
  CCv3DataSchema,
  type CCv2Data,
  type CCv3Data,
} from '@character-foundry/character-foundry/schemas';

// Union schema for card data validation
const CardDataSchema = z.union([CCv2WrappedSchema, CCv3DataSchema]);

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * Check if user can download a card based on visibility
 */
function canDownloadCard(
  card: { visibility: string; uploader?: { id: string } | null },
  userId?: string,
  isAdmin?: boolean
): boolean {
  // Admins can download everything
  if (isAdmin) return true;

  // Private cards: owner only
  if (card.visibility === 'private') {
    return !!userId && card.uploader?.id === userId;
  }

  // Blocked cards: admins only (already handled above)
  if (card.visibility === 'blocked') {
    return false;
  }

  // Public, unlisted, nsfw_only: anyone can download (unlisted just hidden from browse)
  return true;
}

/**
 * Get file from storage (R2 or local filesystem)
 */
async function getFileFromStorage(storagePath: string): Promise<Buffer | null> {
  if (isCloudflareRuntime()) {
    const r2 = await getR2();
    if (!r2) return null;

    // storagePath might be like "cards/abc123.png" or "file:///cards/abc123.png" or "r2://cards/abc123.png"
    const key = storagePath.replace(/^(file:\/\/\/|r2:\/\/)/, '');
    const object = await r2.get(key);
    if (!object) return null;

    const arrayBuffer = await object.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Local filesystem
  const { readFileSync, existsSync } = await import('fs');
  const { join } = await import('path');

  const cleanPath = storagePath.replace(/^file:\/\/\//, '');
  const fullPath = join(process.cwd(), 'uploads', cleanPath);

  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath);
}

/**
 * Stream file from storage (Cloudflare/R2 only)
 */
async function getFileStreamFromStorage(
  storagePath: string
): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null> {
  if (!isCloudflareRuntime()) return null;
  const r2 = await getR2();
  if (!r2) return null;

  const key = storagePath.replace(/^(file:\/\/\/|r2:\/\/)/, '');
  const object = await r2.get(key);
  if (!object?.body) return null;

  // Cloudflare's `@cloudflare/workers-types` declares its own ReadableStream type which isn't
  // assignable to the DOM lib ReadableStream type NextResponse expects. Runtime-compatible.
  return { body: object.body as unknown as ReadableStream<Uint8Array>, size: object.size };
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

    // Check visibility permissions
    const session = await getSession();
    const userId = session?.user.id;
    const isAdmin = session?.user.isAdmin ?? false;

    if (!canDownloadCard(card, userId, isAdmin)) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    const version = card.versionId ? await getCardVersionById(card.versionId) : null;
    await incrementDownloads(card.id);

    // JSON download - just return the card data
    if (format === 'json') {
      return new NextResponse(JSON.stringify(card.cardData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, 'json')}"`,
        },
      });
    }

    // Original format download - return the stored file as-is
    // For collection cards (voxta source), "original" downloads the individual card as PNG
    // because the storage_url points to the whole collection package
    if (format === 'original' && version?.storage_url) {
      const ext = version.storage_url.split('.').pop()?.toLowerCase() || 'bin';

      // For voxta collection cards, fall through to PNG download
      // (storage_url points to the whole .voxpkg, not individual character)
      if (ext !== 'voxpkg' || !card.collectionId) {
        const mimeTypes: Record<string, string> = {
          png: 'image/png',
          charx: 'application/zip',
          json: 'application/json',
          voxpkg: 'application/zip',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        const stream = await getFileStreamFromStorage(version.storage_url);
        if (stream) {
          return new NextResponse(stream.body, {
            headers: {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, ext)}"`,
              ...(typeof stream.size === 'number' ? { 'Content-Length': stream.size.toString() } : {}),
            },
          });
        }

        const fileBuffer = await getFileFromStorage(version.storage_url);
        if (fileBuffer) {
          return new NextResponse(new Uint8Array(fileBuffer), {
            headers: {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, ext)}"`,
            },
          });
        }
      }
      // voxpkg falls through to PNG download below
    }

    // PNG download - try to get stored file first
    if (version?.storage_url) {
      const ext = version.storage_url.split('.').pop()?.toLowerCase() || 'png';

      // If the stored file is already a PNG, return it as-is (streaming when possible)
      if (ext === 'png') {
        const stream = await getFileStreamFromStorage(version.storage_url);
        if (stream) {
          return new NextResponse(stream.body, {
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, 'png')}"`,
              ...(typeof stream.size === 'number' ? { 'Content-Length': stream.size.toString() } : {}),
            },
          });
        }

        const fileBuffer = await getFileFromStorage(version.storage_url);
        if (fileBuffer) {
          return new NextResponse(new Uint8Array(fileBuffer), {
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, 'png')}"`,
            },
          });
        }
      }
    }

    // If we have an image, embed the card data into it and return as PNG
    if (card.imagePath) {
      // imagePath is like "/api/uploads/abc123.png" - extract the key
      const imageKey = card.imagePath.replace(/^\/api\/uploads\//, '');
      const imageBuffer = await getFileFromStorage(imageKey);

      if (imageBuffer) {
        // Validate card data with Zod schema before embedding
        const parseResult = CardDataSchema.safeParse(card.cardData);
        if (!parseResult.success) {
          console.error('Invalid card data structure:', parseResult.error.message);
          return NextResponse.json(
            { error: 'Invalid card data format' },
            { status: 500 }
          );
        }

        // Embed the validated card data into the PNG
        const embeddedPng = embedIntoPNG(
          toUint8Array(imageBuffer),
          parseResult.data as CCv2Data | CCv3Data,
          { key: 'chara', base64: true, minify: true }
        );

        // Convert to Uint8Array for NextResponse (BinaryData type assertion needed)
        const pngBytes = new Uint8Array(embeddedPng as Uint8Array);
        return new NextResponse(pngBytes, {
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, 'png')}"`,
          },
        });
      }
    }

    // Fallback: return JSON if no image available
    return new NextResponse(JSON.stringify(card.cardData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${buildCardExportFilename(card, 'json')}"`,
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
