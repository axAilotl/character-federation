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
import { createCard, checkBlockedTags } from '@/lib/db/cards';
import { processThumbnail } from '@/lib/image/process';
import { generateId, generateSlug } from '@/lib/utils';
import { isCloudflareRuntime } from '@/lib/db';
import { getPublicUrl } from '@/lib/storage';
import { cacheDeleteByPrefix, CACHE_PREFIX } from '@/lib/cache/kv-cache';
import { createCollection, generateCollectionSlug, getCollectionByPackageId } from '@/lib/db/collections';

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

const CollectionInfoSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(50000).optional().default(''),
  creator: z.string().max(200).optional().default(''),
  explicitContent: z.boolean().optional().default(false),
  packageId: z.string().optional().nullable(),
  packageVersion: z.string().optional().nullable(),
  entryResourceKind: z.number().int().optional().nullable(),
  entryResourceId: z.string().optional().nullable(),
  thumbnailResourceKind: z.number().int().optional().nullable(),
  thumbnailResourceId: z.string().optional().nullable(),
  dateCreated: z.string().optional().nullable(),
  dateModified: z.string().optional().nullable(),
  thumbnailCharacterId: z.string().optional().nullable(),
});

const CollectionThumbnailSchema = z.object({
  characterId: z.string().min(1).max(100),
  r2Key: R2KeySchema,
});

const CollectionCardSchema = z.object({
  characterId: z.string().min(1).max(100),
  metadata: CardMetadataSchema,
});

const ConfirmCollectionRequestSchema = z.object({
  type: z.literal('collection'),
  sessionId: z.string().uuid(),
  collection: CollectionInfoSchema,
  files: z.object({
    original: z.object({ r2Key: R2KeySchema }),
    thumbnails: z.array(CollectionThumbnailSchema).min(1).max(1000),
  }),
  cards: z.array(CollectionCardSchema).min(1).max(1000),
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
    if (body && body.type === 'collection') {
      const parsed = ConfirmCollectionRequestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid request', details: parsed.error.format() },
          { status: 400 }
        );
      }

      const { collection, files, cards, visibility } = parsed.data;

      // Basic consistency: every card must have a thumbnail key
      const thumbByCharacterId = new Map(files.thumbnails.map(t => [t.characterId, t.r2Key] as const));
      for (const c of cards) {
        if (!thumbByCharacterId.has(c.characterId)) {
          return NextResponse.json(
            { error: `Missing thumbnail for characterId: ${c.characterId}` },
            { status: 400 }
          );
        }
      }

      // Reject blocked tags up-front (before moving large files)
      const tagSet = new Set<string>();
      for (const c of cards) {
        for (const t of c.metadata.tags) tagSet.add(t);
      }
      tagSet.add('collection');
      const tagSlugs = [...tagSet].map(tag =>
        tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      );
      const blockedTagNames = await checkBlockedTags(tagSlugs);
      if (blockedTagNames.length > 0) {
        // Best-effort cleanup of pending uploads
        await r2.delete(files.original.r2Key);
        await Promise.allSettled(files.thumbnails.map(t => r2.delete(t.r2Key)));
        return NextResponse.json(
          {
            error: `Upload rejected: Collection contains blocked tags: ${blockedTagNames.join(', ')}`,
            blockedTags: blockedTagNames,
          },
          { status: 400 }
        );
      }

      // Verify original file exists in R2
      const originalObject = await r2.head(files.original.r2Key);
      if (!originalObject) {
        return NextResponse.json(
          { error: 'Original file not found. Upload may have failed or expired.' },
          { status: 400 }
        );
      }

      // Reject duplicates by packageId (upgrade flow not implemented here)
      if (collection.packageId) {
        const existing = await getCollectionByPackageId(collection.packageId);
        if (existing) {
          // Best-effort cleanup of pending uploads
          await r2.delete(files.original.r2Key);
          await Promise.allSettled(files.thumbnails.map(t => r2.delete(t.r2Key)));
          return NextResponse.json(
            { error: `Package already uploaded: ${existing.slug}` },
            { status: 400 }
          );
        }
      }

      const collectionId = generateId();
      const collectionSlug = await generateCollectionSlug(collection.name);

      // Move original .voxpkg to permanent collection location
      const permanentOriginalKey = `collections/${collectionId}.voxpkg`;
      await moveR2Object(r2, files.original.r2Key, permanentOriginalKey);
      const storageUrl = `r2://${permanentOriginalKey}`;

      // Collections don't support 'private' - map it to unlisted
      const collectionVisibility = visibility === 'private' ? 'unlisted' : visibility;

      // Determine which character thumbnail to use for collection thumbnail
      const thumbnailCharacterId =
        collection.thumbnailCharacterId ||
        collection.thumbnailResourceId ||
        cards[0].characterId;

      const collectionThumbKey = thumbByCharacterId.get(thumbnailCharacterId) || thumbByCharacterId.get(cards[0].characterId)!;
      let collectionThumbPath: string | null = null;
      let collectionThumbWidth: number | null = null;
      let collectionThumbHeight: number | null = null;

      try {
        const thumbObj = await r2.get(collectionThumbKey);
        if (thumbObj) {
          const buf = Buffer.from(await thumbObj.arrayBuffer());
          if (buf.length > 24) {
            collectionThumbWidth = buf.readUInt32BE(16);
            collectionThumbHeight = buf.readUInt32BE(20);
          }
          const thumbPath = await processThumbnail(new Uint8Array(buf), `collection_${collectionId}`, 'main');
          collectionThumbPath = `/api/uploads/${thumbPath}`;
          collectionThumbWidth = 500;
          collectionThumbHeight = 750;
        }
      } catch (error) {
        console.error('[ConfirmUpload][Collection] Failed to process collection thumbnail:', error);
        collectionThumbPath = null;
      }

      // Create collection record
      await createCollection({
        id: collectionId,
        slug: collectionSlug,
        name: collection.name,
        description: collection.description || null,
        creator: collection.creator || null,
        explicitContent: !!collection.explicitContent,
        packageId: collection.packageId || null,
        packageVersion: collection.packageVersion || null,
        entryResourceKind: collection.entryResourceKind ?? null,
        entryResourceId: collection.entryResourceId ?? null,
        thumbnailResourceKind: collection.thumbnailResourceKind ?? null,
        thumbnailResourceId: collection.thumbnailResourceId ?? null,
        dateCreated: collection.dateCreated ?? null,
        dateModified: collection.dateModified ?? null,
        storageUrl,
        thumbnailPath: collectionThumbPath,
        thumbnailWidth: collectionThumbWidth,
        thumbnailHeight: collectionThumbHeight,
        uploaderId: session.user.id,
        visibility: collectionVisibility as 'public' | 'nsfw_only' | 'unlisted' | 'blocked',
        itemsCount: cards.length,
      });

      // Create cards
      let createdCount = 0;
      for (const c of cards) {
        const meta = c.metadata;
        const thumbKey = thumbByCharacterId.get(c.characterId)!;

        // Download the thumbnail bytes (small) so we can generate a PNG + processed webp thumb
        const thumbObj = await r2.get(thumbKey);
        if (!thumbObj) continue;
        const imgBuffer = Buffer.from(await thumbObj.arrayBuffer());

        const cardId = generateId();
        const slug = generateSlug(meta.name);

        // Move raw thumbnail PNG to a stable location for PNG downloads
        const imageKey = `${cardId}.png`;
        await r2.put(imageKey, imgBuffer);
        await r2.delete(thumbKey);

        const imagePath = isCloudflareRuntime()
          ? getPublicUrl(`r2://${imageKey}`)
          : getPublicUrl(`file:///${imageKey}`);

        let imageWidth: number | null = null;
        let imageHeight: number | null = null;
        if (imgBuffer.length > 24) {
          imageWidth = imgBuffer.readUInt32BE(16);
          imageHeight = imgBuffer.readUInt32BE(20);
        }

        let thumbnailPath: string | null = null;
        let thumbnailWidth: number | null = null;
        let thumbnailHeight: number | null = null;

        try {
          const thumbPath = await processThumbnail(imgBuffer, cardId, 'main');
          thumbnailPath = `/api/uploads/${thumbPath}`;
          thumbnailWidth = 500;
          thumbnailHeight = 750;
        } catch (error) {
          console.error('[ConfirmUpload][Collection] Failed to generate card thumbnail:', error);
          thumbnailPath = imagePath;
          thumbnailWidth = imageWidth;
          thumbnailHeight = imageHeight;
        }

        const allTags = [...new Set([...meta.tags, 'collection'])];

        try {
          await createCard({
            id: cardId,
            slug,
            name: meta.name,
            description: meta.description || null,
            creator: meta.creator || null,
            creatorNotes: meta.creatorNotes || null,
            uploaderId: session.user.id,
            visibility: collectionVisibility,
            tagSlugs: allTags,
            collectionId,
            collectionItemId: c.characterId,
            version: {
              storageUrl, // shared collection .voxpkg
              contentHash: meta.contentHash,
              specVersion: meta.specVersion,
              sourceFormat: meta.sourceFormat,
              tokens: meta.tokens,
              hasAltGreetings: meta.metadata.hasAlternateGreetings,
              altGreetingsCount: meta.metadata.alternateGreetingsCount,
              hasLorebook: meta.metadata.hasLorebook,
              lorebookEntriesCount: meta.metadata.lorebookEntriesCount,
              hasEmbeddedImages: meta.metadata.hasEmbeddedImages,
              embeddedImagesCount: meta.metadata.embeddedImagesCount,
              hasAssets: false,
              assetsCount: 0,
              savedAssets: null,
              imagePath,
              imageWidth,
              imageHeight,
              thumbnailPath,
              thumbnailWidth,
              thumbnailHeight,
              cardData: meta.cardData,
            },
          });
          createdCount++;
        } catch (cardError) {
          console.error('[ConfirmUpload][Collection] Failed to create card:', cardError);
        }
      }

      await cacheDeleteByPrefix(CACHE_PREFIX.CARDS);

      return NextResponse.json({
        success: true,
        type: 'collection',
        data: {
          id: collectionId,
          slug: collectionSlug,
          cardCount: createdCount,
        },
      });
    }

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

    // IMPORTANT: Avoid re-downloading large uploads back into the Worker.
    // We accept client-extracted metadata (the upload UI parses locally) and only do cheap server checks.
    const extToFormat: Record<string, string> = {
      png: 'png',
      json: 'json',
      charx: 'charx',
      voxpkg: 'voxta',
    };
    const originalExt = ext.replace('.', '').toLowerCase();
    const inferredFormat = extToFormat[originalExt];
    if (inferredFormat && inferredFormat !== metadata.sourceFormat) {
      return NextResponse.json(
        { error: `File extension (${originalExt}) does not match sourceFormat (${metadata.sourceFormat})` },
        { status: 400 }
      );
    }

    const validatedMetadata = metadata;

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
        if (assetObject?.body) {
          // Move asset to permanent, public location
          const permanentAssetKey = `assets/${cardId}/${asset.name}.${asset.ext}`;
          await r2.put(permanentAssetKey, assetObject.body, {
            httpMetadata: assetObject.httpMetadata,
            customMetadata: assetObject.customMetadata,
          });
          await r2.delete(asset.r2Key);

          const savedPath = `/api/uploads/${permanentAssetKey}`;
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
      type: 'card',
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
  if (!object.body) throw new Error(`Source object missing body: ${sourceKey}`);

  await r2.put(destKey, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  });

  await r2.delete(sourceKey);
}
