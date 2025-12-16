/**
 * POST /api/uploads/confirm
 *
 * Confirm an upload session after files have been uploaded directly to R2.
 * Moves files from pending to permanent locations and creates card records.
 * Requires authentication.
 *
 * Request body:
 * {
 *   sessionId: string,
 *   metadata: {
 *     name: string,
 *     description: string,
 *     creator: string,
 *     creatorNotes: string,
 *     specVersion: 'v2' | 'v3',
 *     sourceFormat: 'png' | 'json' | 'charx' | 'voxta',
 *     tokens: { description, personality, scenario, mesExample, firstMes, systemPrompt, postHistory, total },
 *     metadata: { hasAlternateGreetings, alternateGreetingsCount, hasLorebook, lorebookEntriesCount, hasEmbeddedImages, embeddedImagesCount },
 *     tags: string[],
 *     contentHash: string,
 *     cardData: string  // JSON stringified card data
 *   },
 *   files: {
 *     original: { r2Key: string },
 *     icon?: { r2Key: string },
 *     assets?: Array<{ r2Key: string, name: string, type: string, ext: string }>
 *   },
 *   visibility: 'public' | 'private' | 'unlisted'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import { getR2 } from '@/lib/cloudflare/env';
import { createCard, checkBlockedTags, computeContentHash } from '@/lib/db/cards';
import { processThumbnail } from '@/lib/image/process';
import { generateId, generateSlug } from '@/lib/utils';
import { isCloudflareRuntime } from '@/lib/db';
import { getPublicUrl } from '@/lib/storage';
import { cacheDeleteByPrefix, CACHE_PREFIX } from '@/lib/cache/kv-cache';
import { parseCard } from '@character-foundry/character-foundry/loader';
import { toUint8Array } from '@character-foundry/character-foundry/core';
import { countCardTokens } from '@/lib/client/tokenizer';
import { extractCardMetadata } from '@/lib/card-metadata';

// Token counts schema
const TokensSchema = z.object({
  description: z.number().int().nonnegative(),
  personality: z.number().int().nonnegative(),
  scenario: z.number().int().nonnegative(),
  mesExample: z.number().int().nonnegative(),
  firstMes: z.number().int().nonnegative(),
  systemPrompt: z.number().int().nonnegative(),
  postHistory: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

// Metadata flags schema
const MetadataFlagsSchema = z.object({
  hasAlternateGreetings: z.boolean(),
  alternateGreetingsCount: z.number().int().nonnegative(),
  hasLorebook: z.boolean(),
  lorebookEntriesCount: z.number().int().nonnegative(),
  hasEmbeddedImages: z.boolean(),
  embeddedImagesCount: z.number().int().nonnegative(),
});

// Full metadata schema
const CardMetadataSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(50000).optional().default(''),
  creator: z.string().max(200).optional().default(''),
  creatorNotes: z.string().max(50000).optional().default(''),
  specVersion: z.enum(['v2', 'v3']),
  sourceFormat: z.enum(['png', 'json', 'charx', 'voxta']),
  tokens: TokensSchema,
  metadata: MetadataFlagsSchema,
  tags: z.array(z.string()).default([]),
  contentHash: z.string().min(1),
  cardData: z.string().min(1), // JSON stringified
});

// Secure r2Key schema - prevents path traversal and ensures keys are in pending directory
const R2KeySchema = z.string()
  .min(1)
  .refine(
    (key) => key.startsWith('uploads/pending/'),
    'r2Key must start with uploads/pending/'
  )
  .refine(
    (key) => !key.includes('..'),
    'r2Key cannot contain path traversal'
  )
  .refine(
    (key) => !key.includes('//'),
    'r2Key cannot contain double slashes'
  );

// Files schema
const FilesSchema = z.object({
  original: z.object({ r2Key: R2KeySchema }),
  icon: z.object({ r2Key: R2KeySchema }).optional(),
  assets: z.array(z.object({
    r2Key: R2KeySchema,
    name: z.string().min(1),
    type: z.string().min(1),
    ext: z.string().min(1),
    originalPath: z.string().optional(),  // Original path inside package (e.g., "assets/icon/main.png")
  })).optional().default([]),
});

// Request schema
const ConfirmRequestSchema = z.object({
  sessionId: z.string().uuid(),
  metadata: CardMetadataSchema,
  files: FilesSchema,
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
});

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if uploads are enabled
    const { isUploadsEnabled } = await import('@/lib/db/settings');
    const uploadsAllowed = await isUploadsEnabled();
    if (!uploadsAllowed) {
      return NextResponse.json(
        { error: 'Card uploads are currently disabled' },
        { status: 403 }
      );
    }

    // Get R2 binding
    const r2 = await getR2();
    if (!r2) {
      return NextResponse.json(
        { error: 'Storage not available' },
        { status: 503 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = ConfirmRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { metadata, files, visibility } = parsed.data;

    // Verify original file exists in R2
    const originalObject = await r2.head(files.original.r2Key);
    if (!originalObject) {
      return NextResponse.json(
        { error: 'Original file not found. Upload may have failed or expired.' },
        { status: 400 }
      );
    }

    // Generate card IDs
    const cardId = generateId();
    const slug = generateSlug(metadata.name);

    // Determine file extension from original key
    const extMatch = files.original.r2Key.match(/\.([^.]+)$/);
    const ext = extMatch ? `.${extMatch[1]}` : '.bin';

    // Move original file to permanent location
    const permanentOriginalKey = `cards/${cardId}${ext}`;
    await moveR2Object(r2, files.original.r2Key, permanentOriginalKey);
    const storageUrl = `r2://${permanentOriginalKey}`;

    // SECURITY: Re-parse and validate all metadata server-side
    // Never trust client-provided tokens, contentHash, or metadata flags
    console.log('[ConfirmUpload] Re-parsing card for server-side validation');

    // Download the file we just moved
    const serverOriginal = await r2.get(permanentOriginalKey);
    if (!serverOriginal) {
      // Clean up uploaded files and fail
      await r2.delete(permanentOriginalKey);
      if (files.icon) await r2.delete(files.icon.r2Key);
      return NextResponse.json(
        { error: 'Failed to retrieve uploaded file for validation' },
        { status: 500 }
      );
    }

    const serverBuffer = Buffer.from(await serverOriginal.arrayBuffer());
    const serverUint8 = toUint8Array(serverBuffer);

    // Parse card using character-foundry loader
    let serverParsed;
    try {
      serverParsed = parseCard(serverUint8, { extractAssets: false }); // Assets already handled
    } catch (parseError) {
      // Clean up uploaded files
      await r2.delete(permanentOriginalKey);
      if (files.icon) await r2.delete(files.icon.r2Key);
      return NextResponse.json(
        { error: `Invalid card format: ${parseError instanceof Error ? parseError.message : 'parse failed'}` },
        { status: 400 }
      );
    }

    const serverCardData = serverParsed.card.data;

    // Compute server-side values
    const serverContentHash = computeContentHash(serverBuffer);
    const serverTokens = countCardTokens(serverCardData);
    const serverMetadata = extractCardMetadata(serverCardData);

    // Log any mismatches (for monitoring)
    if (serverContentHash !== metadata.contentHash) {
      console.warn(`[ConfirmUpload] contentHash mismatch: client=${metadata.contentHash} server=${serverContentHash}`);
    }
    if (serverTokens.total !== metadata.tokens.total) {
      console.warn(`[ConfirmUpload] tokens mismatch: client=${metadata.tokens.total} server=${serverTokens.total}`);
    }

    // Replace client-provided metadata with server-computed values
    const validatedMetadata = {
      ...metadata,
      contentHash: serverContentHash,  // ✅ Server-computed
      tokens: serverTokens,              // ✅ Server-computed
      metadata: {
        hasAlternateGreetings: serverMetadata.hasAlternateGreetings,  // ✅ Server-computed
        alternateGreetingsCount: serverMetadata.alternateGreetingsCount,
        hasLorebook: serverMetadata.hasLorebook,
        lorebookEntriesCount: serverMetadata.lorebookEntriesCount,
        hasEmbeddedImages: serverMetadata.hasEmbeddedImages,
        embeddedImagesCount: serverMetadata.embeddedImagesCount,
      },
    };

    // Use validatedMetadata for the rest of the flow (replaces client metadata)

    // Process icon if provided
    let imagePath: string | null = null;
    let imageWidth: number | null = null;
    let imageHeight: number | null = null;
    let thumbnailPath: string | null = null;
    let thumbnailWidth: number | null = null;
    let thumbnailHeight: number | null = null;

    if (files.icon) {
      // Verify icon exists
      const iconObject = await r2.get(files.icon.r2Key);
      if (iconObject) {
        const iconBuffer = await iconObject.arrayBuffer();
        const iconData = Buffer.from(iconBuffer);

        // Move icon to permanent location
        const permanentIconKey = `${cardId}.png`;
        await r2.put(permanentIconKey, iconData);
        await r2.delete(files.icon.r2Key);

        imagePath = isCloudflareRuntime()
          ? getPublicUrl(`r2://${permanentIconKey}`)
          : getPublicUrl(`file:///${permanentIconKey}`);

        // Get image dimensions from PNG header
        if (iconData.length > 24) {
          imageWidth = iconData.readUInt32BE(16);
          imageHeight = iconData.readUInt32BE(20);
        }

        // Generate thumbnail
        try {
          const thumbPath = await processThumbnail(new Uint8Array(iconData), cardId, 'main');
          thumbnailPath = `/api/uploads/${thumbPath}`;
          thumbnailWidth = 500;
          thumbnailHeight = 750;
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
          thumbnailPath = imagePath;
          thumbnailWidth = imageWidth;
          thumbnailHeight = imageHeight;
        }
      }
    }

    // Process assets and build URL mapping for internal references
    const savedAssetsData: Array<{ name: string; type: string; ext: string; path: string; thumbnailPath?: string }> = [];
    const assetUrlMapping = new Map<string, string>();

    if (files.assets && files.assets.length > 0) {
      for (const asset of files.assets) {
        const assetObject = await r2.get(asset.r2Key);
        if (assetObject) {
          const assetBuffer = await assetObject.arrayBuffer();
          const assetData = Buffer.from(assetBuffer);

          // Move asset to permanent location
          const permanentAssetKey = `uploads/assets/${cardId}/${asset.name}.${asset.ext}`;
          await r2.put(permanentAssetKey, assetData);
          await r2.delete(asset.r2Key);

          const savedPath = `/api/uploads/uploads/assets/${cardId}/${asset.name}.${asset.ext}`;
          savedAssetsData.push({
            name: asset.name,
            type: asset.type,
            ext: asset.ext,
            path: savedPath,
          });

          // Build URL mapping from internal paths to saved paths
          // CharX uses paths like "embeded://assets/icon/main.png" or "ccdefault://assets/..."
          if (asset.originalPath) {
            // Map various internal URL schemes to the saved path
            assetUrlMapping.set(`embeded://${asset.originalPath}`, savedPath);
            assetUrlMapping.set(`ccdefault://${asset.originalPath}`, savedPath);
            // Also map relative paths
            assetUrlMapping.set(asset.originalPath, savedPath);
          }
        }
      }
    }

    // Rewrite internal asset URLs in cardData
    let processedCardData = validatedMetadata.cardData;
    if (assetUrlMapping.size > 0) {
      for (const [originalUrl, newUrl] of assetUrlMapping) {
        // Escape special regex characters in the URL
        const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processedCardData = processedCardData.replace(new RegExp(escaped, 'g'), newUrl);
      }
      console.log(`[ConfirmUpload] Rewrote ${assetUrlMapping.size} asset URLs in cardData`);
    }

    // Validate tags
    const allTags = [...new Set(validatedMetadata.tags)];
    const allTagSlugs = allTags.map(tag =>
      tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    );

    // Check for blocked tags
    const blockedTagNames = await checkBlockedTags(allTagSlugs);
    if (blockedTagNames.length > 0) {
      // Clean up uploaded files
      await r2.delete(permanentOriginalKey);
      if (imagePath) {
        await r2.delete(`${cardId}.png`);
      }
      return NextResponse.json(
        {
          error: `Upload rejected: Card contains blocked tags: ${blockedTagNames.join(', ')}`,
          blockedTags: blockedTagNames,
        },
        { status: 400 }
      );
    }

    // Create card record
    const { cardId: createdCardId, versionId } = await createCard({
      id: cardId,
      slug,
      name: validatedMetadata.name,
      description: validatedMetadata.description || null,
      creator: validatedMetadata.creator || null,
      creatorNotes: validatedMetadata.creatorNotes || null,
      uploaderId: session.user.id,
      visibility,
      tagSlugs: allTags,
      version: {
        storageUrl,
        contentHash: validatedMetadata.contentHash,
        specVersion: validatedMetadata.specVersion,
        sourceFormat: validatedMetadata.sourceFormat,
        tokens: validatedMetadata.tokens,
        hasAltGreetings: validatedMetadata.metadata.hasAlternateGreetings,
        altGreetingsCount: validatedMetadata.metadata.alternateGreetingsCount,
        hasLorebook: validatedMetadata.metadata.hasLorebook,
        lorebookEntriesCount: validatedMetadata.metadata.lorebookEntriesCount,
        hasEmbeddedImages: validatedMetadata.metadata.hasEmbeddedImages,
        embeddedImagesCount: validatedMetadata.metadata.embeddedImagesCount,
        hasAssets: savedAssetsData.length > 0,
        assetsCount: savedAssetsData.length,
        savedAssets: savedAssetsData.length > 0 ? JSON.stringify(savedAssetsData) : null,
        imagePath,
        imageWidth,
        imageHeight,
        thumbnailPath,
        thumbnailWidth,
        thumbnailHeight,
        cardData: processedCardData,
      },
    });

    // Invalidate listing caches
    await cacheDeleteByPrefix(CACHE_PREFIX.CARDS);

    return NextResponse.json({
      success: true,
      data: {
        id: createdCardId,
        slug,
        name: validatedMetadata.name,
        versionId,
      },
    });
  } catch (error) {
    console.error('Error confirming upload:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to confirm upload' },
      { status: 500 }
    );
  }
}

/**
 * Move an R2 object from one key to another
 * R2 doesn't have native move, so we copy + delete
 */
async function moveR2Object(
  r2: Awaited<ReturnType<typeof getR2>>,
  sourceKey: string,
  destKey: string
): Promise<void> {
  if (!r2) throw new Error('R2 not available');

  const object = await r2.get(sourceKey);
  if (!object) throw new Error(`Source object not found: ${sourceKey}`);

  const data = await object.arrayBuffer();
  await r2.put(destKey, data, {
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  });

  await r2.delete(sourceKey);
}
