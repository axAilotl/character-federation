import { NextRequest, NextResponse } from 'next/server';
import { getCards, createCard, computeContentHash, checkBlockedTags, updateCardVersion } from '@/lib/db/cards';
import { parseCard } from '@character-foundry/character-foundry/loader';
import { isVoxta, readVoxta, voxtaToCCv3, enrichVoxtaAsset, type VoxtaData, type VoxtaBook, type ExtractedVoxtaAsset } from '@character-foundry/character-foundry/voxta';
import { toUint8Array } from '@character-foundry/character-foundry/core';
import { countCardTokens } from '@/lib/client/tokenizer';
import { saveAssets } from '@/lib/image';
import { processThumbnail, processCardImages } from '@/lib/image/process';
import { generateId, generateSlug } from '@/lib/utils';
import { store, getPublicUrl } from '@/lib/storage';
import { getSession } from '@/lib/auth';
import { isCloudflareRuntime } from '@/lib/db';
import { cacheDeleteByPrefix, CACHE_PREFIX } from '@/lib/cache/kv-cache';
import {
  parseQuery,
  CardFiltersSchema,
  CardFileSchema,
  UploadVisibilitySchema,
} from '@/lib/validations';
import type { CardFilters } from '@/types/card';
import {
  createCollection,
  getCollectionByPackageId,
  generateCollectionSlug,
} from '@/lib/db/collections';

// Use shared utility for counting embedded images and extracting metadata
import { extractCardMetadata } from '@/lib/card-metadata';

/**
 * Convert Voxta assets to our standard format
 */
function convertVoxtaAssets(
  voxtaAssets: ExtractedVoxtaAsset[]
): Array<{ name: string; type: string; ext: string; buffer: Buffer; path?: string }> {
  return voxtaAssets.map(asset => {
    const pathParts = asset.path.split('/');
    const filename = pathParts[pathParts.length - 1] || asset.path;
    const extMatch = filename.match(/\.([^.]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const name = filename.replace(/\.[^.]+$/, '') || filename;

    // Get enriched metadata for type
    const enriched = enrichVoxtaAsset(asset);

    return {
      name,
      type: enriched.type,
      ext,
      buffer: Buffer.from(asset.buffer as Uint8Array),
      path: asset.path,
    };
  });
}

/**
 * Handle multi-character Voxta package upload (creates collection + cards)
 */
async function handleVoxtaCollectionUpload(
  voxtaData: VoxtaData,
  buffer: Buffer,
  uploaderId: string,
  visibility: 'public' | 'private' | 'nsfw_only' | 'unlisted',
  tagSlugs: string[]
): Promise<{ collectionId: string; collectionSlug: string; cardCount: number }> {
  // Create synthetic package if none exists (for character-only exports)
  const pkg = voxtaData.package || {
    $type: 'package' as const,
    Id: generateId(),
    Name: voxtaData.characters[0]?.data?.Name
      ? `${voxtaData.characters[0].data.Name} & Friends`
      : `${voxtaData.characters.length} Characters`,
    Version: '1.0.0',
    Description: `Collection of ${voxtaData.characters.length} characters`,
    Creator: voxtaData.characters[0]?.data?.Creator,
    ExplicitContent: voxtaData.characters.some(c => c.data?.ExplicitContent),
  };

  // Check if this package already exists (for upgrade detection)
  if (voxtaData.package?.Id) {
    const existing = await getCollectionByPackageId(pkg.Id);
    if (existing) {
      // Check date_modified for upgrade
      if (pkg.DateModified && existing.dateModified) {
        const newDate = new Date(pkg.DateModified).getTime();
        const existingDate = new Date(existing.dateModified).getTime();
        if (newDate <= existingDate) {
          throw new Error(`Package "${pkg.Name}" already uploaded. Upload a newer version to update.`);
        }
      } else {
        throw new Error(`Package "${pkg.Name}" already exists.`);
      }
      // TODO: Implement upgrade flow (create new versions for changed characters)
      throw new Error('Package upgrade not yet implemented. Delete the existing collection first.');
    }
  }

  const collectionId = generateId();
  const collectionSlug = await generateCollectionSlug(pkg.Name || 'Untitled Collection');

  // Store original .voxpkg
  const storageUrl = await store(buffer, `collections/${collectionId}.voxpkg`);

  // Find collection thumbnail
  let thumbnailPath: string | null = null;
  let thumbnailWidth: number | null = null;
  let thumbnailHeight: number | null = null;

  // Try to find thumbnail from ThumbnailResource
  if (pkg.ThumbnailResource?.Id) {
    const thumbChar = voxtaData.characters.find(c => c.id === pkg.ThumbnailResource!.Id);
    if (thumbChar?.thumbnail) {
      const thumbBuffer = Buffer.from(thumbChar.thumbnail as Uint8Array);
      try {
        const thumbPath = await processThumbnail(thumbBuffer, `collection_${collectionId}`, 'main');
        thumbnailPath = `/api/uploads/${thumbPath}`;
        thumbnailWidth = 500;
        thumbnailHeight = 750;
      } catch {
        // Fallback: store original
        const thumbName = `collections/${collectionId}_thumb.png`;
        await store(thumbBuffer, thumbName);
        thumbnailPath = getPublicUrl(isCloudflareRuntime() ? `r2://${thumbName}` : `file:///${thumbName}`);
        if (thumbBuffer.length > 24) {
          thumbnailWidth = thumbBuffer.readUInt32BE(16);
          thumbnailHeight = thumbBuffer.readUInt32BE(20);
        }
      }
    }
  }

  // Fallback: use first character's thumbnail
  if (!thumbnailPath && voxtaData.characters.length > 0) {
    const firstChar = voxtaData.characters[0];
    if (firstChar.thumbnail) {
      const thumbBuffer = Buffer.from(firstChar.thumbnail as Uint8Array);
      try {
        const thumbPath = await processThumbnail(thumbBuffer, `collection_${collectionId}`, 'main');
        thumbnailPath = `/api/uploads/${thumbPath}`;
        thumbnailWidth = 500;
        thumbnailHeight = 750;
      } catch {
        // Fallback: store original
        const thumbName = `collections/${collectionId}_thumb.png`;
        await store(thumbBuffer, thumbName);
        thumbnailPath = getPublicUrl(isCloudflareRuntime() ? `r2://${thumbName}` : `file:///${thumbName}`);
        if (thumbBuffer.length > 24) {
          thumbnailWidth = thumbBuffer.readUInt32BE(16);
          thumbnailHeight = thumbBuffer.readUInt32BE(20);
        }
      }
    }
  }

  // Map 'private' to 'unlisted' for collections (collections don't support 'private')
  const collectionVisibility = visibility === 'private' ? 'unlisted' : visibility;

  // Create collection record
  await createCollection({
    id: collectionId,
    slug: collectionSlug,
    name: pkg.Name || 'Untitled Collection',
    description: pkg.Description || null,
    creator: pkg.Creator || null,
    explicitContent: !!pkg.ExplicitContent,
    packageId: pkg.Id || null,
    packageVersion: pkg.Version || null,
    entryResourceKind: pkg.EntryResource?.Kind || null,
    entryResourceId: pkg.EntryResource?.Id || null,
    thumbnailResourceKind: pkg.ThumbnailResource?.Kind || null,
    thumbnailResourceId: pkg.ThumbnailResource?.Id || null,
    dateCreated: pkg.DateCreated || null,
    dateModified: pkg.DateModified || null,
    storageUrl,
    thumbnailPath,
    thumbnailWidth,
    thumbnailHeight,
    uploaderId,
    visibility: collectionVisibility,
    itemsCount: voxtaData.characters.length,
  });

  // Create individual cards for each character
  console.log(`[Collection] Creating ${voxtaData.characters.length} cards for collection ${collectionSlug}`);
  let createdCount = 0;
  for (const extractedChar of voxtaData.characters) {
    // Convert Voxta character to CCv3
    const referencedBooks = extractedChar.data.MemoryBooks
      ? voxtaData.books
          .filter(b => extractedChar.data.MemoryBooks?.includes(b.id))
          .map(b => b.data)
      : [];
    const ccv3 = voxtaToCCv3(extractedChar.data, referencedBooks);
    const cardData = ccv3.data;

    // Generate card IDs
    const cardId = generateId();
    const cardSlug = generateSlug(cardData.name || 'Unknown');

    // Calculate tokens
    const tokens = countCardTokens(cardData);

    // Extract card metadata using canonical implementation
    const metadata = extractCardMetadata(cardData);

    // Find character thumbnail
    let charImagePath: string | null = null;
    let charImageWidth: number | null = null;
    let charImageHeight: number | null = null;
    let charThumbPath: string | null = null;
    let charThumbWidth: number | null = null;
    let charThumbHeight: number | null = null;

    // Use the character's thumbnail field (extracted by readVoxta)
    if (extractedChar.thumbnail) {
      const imgBuffer = Buffer.from(extractedChar.thumbnail as Uint8Array);
      const imageName = `${cardId}.png`;
      await store(imgBuffer, imageName);

      charImagePath = isCloudflareRuntime()
        ? getPublicUrl(`r2://${imageName}`)
        : getPublicUrl(`file:///${imageName}`);

      if (imgBuffer.length > 24) {
        charImageWidth = imgBuffer.readUInt32BE(16);
        charImageHeight = imgBuffer.readUInt32BE(20);
      }

      // Generate and store thumbnail (processed once, served directly)
      try {
        const thumbPath = await processThumbnail(imgBuffer, cardId, 'main');
        charThumbPath = `/api/uploads/${thumbPath}`;
        charThumbWidth = 500;
        charThumbHeight = 750;
      } catch {
        // Fallback: serve original image
        charThumbPath = charImagePath;
        charThumbWidth = charImageWidth;
        charThumbHeight = charImageHeight;
      }
    }

    // Cards inherit visibility from collection
    const cardVisibility = collectionVisibility;

    // Combine tags: character tags + user tags + "collection" tag
    const charTags = cardData.tags || [];
    const allTags = [...new Set([...charTags, ...tagSlugs, 'collection'])];

    // Save extracted assets from Voxta character
    let savedAssetsData: Array<{ name: string; type: string; ext: string; path: string; thumbnailPath?: string }> = [];
    if (extractedChar.assets && extractedChar.assets.length > 0) {
      try {
        const convertedAssets = convertVoxtaAssets(extractedChar.assets);
        const assetsResult = await saveAssets(cardId, convertedAssets);
        savedAssetsData = assetsResult.assets.map(a => ({
          name: a.name,
          type: a.type,
          ext: a.ext,
          path: a.path,
          thumbnailPath: a.thumbnailPath,
        }));
        console.log(`[Collection] Saved ${savedAssetsData.length} assets for ${cardData.name}`);
      } catch (assetError) {
        console.error(`[Collection] Failed to save assets for ${cardData.name}:`, assetError);
      }
    }

    // ASYNC IMAGE PROCESSING: Skip during upload (process async after)
    const displayCcv3: unknown = ccv3;

    // Create card with collection reference
    try {
      await createCard({
      id: cardId,
      slug: cardSlug,
      name: cardData.name || 'Unknown',
      description: cardData.description || null,
      creator: cardData.creator || null,
      creatorNotes: cardData.creator_notes || null,
      uploaderId,
      visibility: cardVisibility,
      tagSlugs: allTags,
      collectionId,
      collectionItemId: extractedChar.id,
      version: {
        storageUrl, // Points to the collection's .voxpkg
        contentHash: computeContentHash(Buffer.from(JSON.stringify(cardData))),
        specVersion: 'v3',
        sourceFormat: 'voxta',
        tokens,
        hasAltGreetings: metadata.hasAlternateGreetings,
        altGreetingsCount: metadata.alternateGreetingsCount,
        hasLorebook: metadata.hasLorebook,
        lorebookEntriesCount: metadata.lorebookEntriesCount,
        hasEmbeddedImages: metadata.hasEmbeddedImages,
        embeddedImagesCount: metadata.embeddedImagesCount,
        hasAssets: (extractedChar.assets?.length || 0) > 0,
        assetsCount: savedAssetsData.length || (extractedChar.assets?.length || 0),
        savedAssets: savedAssetsData.length > 0 ? JSON.stringify(savedAssetsData) : null,
        imagePath: charImagePath,
        imageWidth: charImageWidth,
        imageHeight: charImageHeight,
        thumbnailPath: charThumbPath,
        thumbnailWidth: charThumbWidth,
        thumbnailHeight: charThumbHeight,
        cardData: JSON.stringify(displayCcv3),
      },
    });
      createdCount++;
      console.log(`[Collection] Created card ${createdCount}/${voxtaData.characters.length}: ${cardData.name}`);
    } catch (cardError) {
      console.error(`[Collection] Failed to create card for ${cardData.name}:`, cardError);
      // Continue with other cards
    }
  }

  console.log(`[Collection] Finished: ${createdCount}/${voxtaData.characters.length} cards created`);

  return {
    collectionId,
    collectionSlug,
    cardCount: createdCount,
  };
}

/**
 * Client-provided metadata structure
 */
interface ClientMetadata {
  name: string;
  description: string;
  creator: string;
  creatorNotes: string;
  specVersion: 'v2' | 'v3';
  sourceFormat: 'png' | 'json' | 'charx' | 'voxta';
  tokens: {
    description: number;
    personality: number;
    scenario: number;
    mesExample: number;
    firstMes: number;
    systemPrompt: number;
    postHistory: number;
    total: number;
  };
  metadata: {
    hasAlternateGreetings: boolean;
    alternateGreetingsCount: number;
    hasLorebook: boolean;
    lorebookEntriesCount: number;
    hasEmbeddedImages: boolean;
    embeddedImagesCount: number;
  };
  tags: string[];
  contentHash: string;
  cardData: string;
}

/**
 * GET /api/cards
 * List cards with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    // Parse and validate query parameters
    const parsed = parseQuery(request.nextUrl.searchParams, CardFiltersSchema);
    if ('error' in parsed) return parsed.error;

    const filters: CardFilters = {
      search: parsed.data.search,
      tags: parsed.data.tags,
      excludeTags: parsed.data.excludeTags,
      sort: parsed.data.sort,
      page: parsed.data.page,
      limit: parsed.data.limit,
      minTokens: parsed.data.minTokens,
      maxTokens: parsed.data.maxTokens,
      hasAltGreetings: parsed.data.hasAltGreetings || false,
      hasLorebook: parsed.data.hasLorebook || false,
      hasEmbeddedImages: parsed.data.hasEmbeddedImages || false,
      includeNsfw: parsed.data.includeNsfw || false,
    };

    // Get session to include isFavorited status for authenticated users
    const session = await getSession();
    const userId = session?.user?.id;

    const result = await getCards(filters, userId);

    // Only use public cache for anonymous requests (no userId)
    // Authenticated requests include isFavorited and should not be cached by CDN
    const cacheControl = userId
      ? 'private, max-age=0, must-revalidate'  // Authenticated: no CDN cache
      : 'public, s-maxage=60, stale-while-revalidate=30';  // Anonymous: 60s cache

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Error fetching cards:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cards' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cards
 * Upload a new card (creates Card + CardVersion)
 * Requires authentication
 * Supports client-side parsing - if metadata is provided, skips server-side parsing
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required to upload cards' },
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

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const tagsJson = formData.get('tags') as string | null;
    const metadataJson = formData.get('metadata') as string | null;
    const visibilityRaw = formData.get('visibility') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file with Zod schema
    const fileValidation = CardFileSchema.safeParse({ name: file.name, size: file.size });
    if (!fileValidation.success) {
      const firstError = fileValidation.error.errors[0];
      return NextResponse.json(
        { error: firstError.message },
        { status: 400 }
      );
    }

    // Validate visibility with Zod schema
    const visibilityValidation = UploadVisibilitySchema.safeParse(visibilityRaw || 'public');
    if (!visibilityValidation.success) {
      return NextResponse.json(
        { error: `Invalid visibility. Must be one of: public, private, nsfw_only, unlisted` },
        { status: 400 }
      );
    }
    const visibility = visibilityValidation.data;

    // Extract file extension for storage (already validated by CardFileSchema)
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();

    // Parse tags from request
    const tagSlugs: string[] = tagsJson ? JSON.parse(tagsJson) : [];

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const uint8Buffer = toUint8Array(buffer);

    // Helper to try Voxta parsing (used for both detection and fallback)
    // Returns: response if handled, 'single' if single-char Voxta (needs voxtaData), null if not Voxta
    let voxtaDataForSingleChar: VoxtaData | null = null;
    let lastVoxtaError: string | null = null;
    const tryVoxtaParsing = async (): Promise<NextResponse | 'single' | null> => {
      try {
        console.log('[Upload] Trying Voxta parsing...');
        const voxtaData = readVoxta(uint8Buffer, { maxFileSize: 50 * 1024 * 1024 });
        console.log('[Upload] Voxta parsed successfully, characters:', voxtaData.characters.length);

        // If 2+ characters, create a collection
        // Note: Some Voxta exports don't have package.json (exportType: 'character')
        if (voxtaData.characters.length >= 2) {
          const result = await handleVoxtaCollectionUpload(
            voxtaData,
            buffer,
            session.user.id,
            visibility as 'public' | 'private' | 'nsfw_only' | 'unlisted',
            tagSlugs
          );

          // Invalidate listing caches so new cards appear in results
          await cacheDeleteByPrefix(CACHE_PREFIX.CARDS);

          return NextResponse.json({
            success: true,
            type: 'collection',
            data: {
              id: result.collectionId,
              slug: result.collectionSlug,
              cardCount: result.cardCount,
            },
          });
        }
        // Single character Voxta - save data for later processing
        if (voxtaData.characters.length === 1) {
          voxtaDataForSingleChar = voxtaData;
          return 'single';
        }
        return null;
      } catch (voxtaError) {
        lastVoxtaError = voxtaError instanceof Error ? voxtaError.message : String(voxtaError);
        console.log('[Upload] Voxta parsing failed:', lastVoxtaError);
        return null;
      }
    };

    // Check for Voxta package (quick detection first, then fallback)
    let isVoxtaPackage = false;
    if (isVoxta(uint8Buffer)) {
      const voxtaResponse = await tryVoxtaParsing();
      if (voxtaResponse instanceof NextResponse) return voxtaResponse;
      if (voxtaResponse === 'single') isVoxtaPackage = true;
    }

    // NOTE: Client-provided metadata is NO LONGER trusted.
    // We always recompute everything server-side for security.
    // The metadataJson parameter is accepted but ignored.
    void metadataJson; // Explicitly ignore (backwards compat - clients may still send it)

    // ALWAYS compute content hash server-side (never trust client)
    const contentHash = computeContentHash(buffer);

    // Parse card data - use client metadata if available, otherwise parse server-side
    // Definite assignment assertion: parsedCard is always assigned before use
    // (either by Voxta handling, parseCard success, or Voxta fallback - other paths throw)
    let parsedCard!: {
      name: string;
      description: string;
      creator: string;
      creatorNotes: string;
      specVersion: 'v2' | 'v3';
      sourceFormat: 'png' | 'json' | 'charx' | 'voxta';
      tokens: ClientMetadata['tokens'];
      metadata: ClientMetadata['metadata'];
      tags: string[];
      raw: unknown;
    };
    let mainImage: Buffer | undefined;
    let extractedAssets: Array<{ name: string; type: string; ext: string; buffer: Buffer; path?: string }> = [];

    // Handle single-character Voxta package
    if (isVoxtaPackage && voxtaDataForSingleChar) {
      // Type assertion needed because TS can't track closure state through async functions
      const voxtaData = voxtaDataForSingleChar as VoxtaData;
      const extractedChar = voxtaData.characters[0];
      const referencedBooks: VoxtaBook[] = extractedChar.data.MemoryBooks
        ? voxtaData.books
            .filter(b => extractedChar.data.MemoryBooks?.includes(b.id))
            .map(b => b.data)
        : [];
      const ccv3 = voxtaToCCv3(extractedChar.data, referencedBooks);
      const cardData = ccv3.data;
      const tokens = countCardTokens(cardData);
      const metadata = extractCardMetadata(cardData);

      parsedCard = {
        name: cardData.name || 'Unknown',
        description: cardData.description || '',
        creator: cardData.creator || '',
        creatorNotes: cardData.creator_notes || '',
        specVersion: 'v3',
        sourceFormat: 'voxta',
        tokens,
        metadata: {
          hasAlternateGreetings: metadata.hasAlternateGreetings,
          alternateGreetingsCount: metadata.alternateGreetingsCount,
          hasLorebook: metadata.hasLorebook,
          lorebookEntriesCount: metadata.lorebookEntriesCount,
          hasEmbeddedImages: metadata.hasEmbeddedImages,
          embeddedImagesCount: metadata.embeddedImagesCount,
        },
        tags: cardData.tags || [],
        raw: ccv3,
      };

      // Get thumbnail from ThumbnailResource if specified, otherwise use character's thumbnail
      // ThumbnailResource.Kind: 3 = Character, 2 = Scenario
      const pkg = voxtaData.package;
      let thumbnailSource = extractedChar; // Default to the character being uploaded

      if (pkg?.ThumbnailResource?.Id) {
        // Look up the character specified by ThumbnailResource
        const thumbResourceChar = voxtaData.characters.find(c => c.id === pkg.ThumbnailResource!.Id);
        if (thumbResourceChar?.thumbnail) {
          thumbnailSource = thumbResourceChar;
          console.log(`[Upload] Using ThumbnailResource character ${pkg.ThumbnailResource.Id} for thumbnail`);
        }
      }

      if (thumbnailSource.thumbnail) {
        mainImage = Buffer.from(thumbnailSource.thumbnail as Uint8Array);
      }

      // Extract assets from Voxta character
      if (extractedChar.assets && extractedChar.assets.length > 0) {
        extractedAssets = convertVoxtaAssets(extractedChar.assets);
        console.log(`[Upload] Extracted ${extractedAssets.length} assets from Voxta character`);
      }
    } else {
      // Parse card using character-foundry loader
      // Wrap in try/catch to handle unrecognized formats (fallback to Voxta for ZIPs)
      let parseResult;
      try {
        parseResult = parseCard(uint8Buffer, { extractAssets: true });
      } catch (parseError) {
        // If parseCard fails with unrecognized ZIP, try Voxta as fallback
        // This handles cases where isVoxta() quick detection missed a valid .voxpkg
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        console.log('[Upload] parseCard failed:', errorMessage);
        if (errorMessage.includes('ZIP archive without recognized card structure')) {
          console.log('[Upload] Attempting Voxta fallback for unrecognized ZIP...');
          const voxtaResponse = await tryVoxtaParsing();
          if (voxtaResponse instanceof NextResponse) return voxtaResponse;
          if (voxtaResponse === 'single' && voxtaDataForSingleChar) {
            // Retry with the single-char Voxta handling
            // This is a bit awkward but avoids code duplication
            isVoxtaPackage = true;
            // Type assertion needed because TS can't track closure state through async functions
            const voxtaData = voxtaDataForSingleChar as VoxtaData;
            const extractedChar = voxtaData.characters[0];
            const referencedBooks: VoxtaBook[] = extractedChar.data.MemoryBooks
              ? voxtaData.books
                  .filter(b => extractedChar.data.MemoryBooks?.includes(b.id))
                  .map(b => b.data)
              : [];
            const ccv3 = voxtaToCCv3(extractedChar.data, referencedBooks);
            const cardDataFromVoxta = ccv3.data;
            const tokens = countCardTokens(cardDataFromVoxta);
            const metadata = extractCardMetadata(cardDataFromVoxta);

            parsedCard = {
              name: cardDataFromVoxta.name || 'Unknown',
              description: cardDataFromVoxta.description || '',
              creator: cardDataFromVoxta.creator || '',
              creatorNotes: cardDataFromVoxta.creator_notes || '',
              specVersion: 'v3',
              sourceFormat: 'voxta',
              tokens,
              metadata: {
                hasAlternateGreetings: metadata.hasAlternateGreetings,
                alternateGreetingsCount: metadata.alternateGreetingsCount,
                hasLorebook: metadata.hasLorebook,
                lorebookEntriesCount: metadata.lorebookEntriesCount,
                hasEmbeddedImages: metadata.hasEmbeddedImages,
                embeddedImagesCount: metadata.embeddedImagesCount,
              },
              tags: cardDataFromVoxta.tags || [],
              raw: ccv3,
            };

            // Get thumbnail from ThumbnailResource if specified
            const fallbackPkg = voxtaData.package;
            let fallbackThumbSource = extractedChar;

            if (fallbackPkg?.ThumbnailResource?.Id) {
              const thumbResourceChar = voxtaData.characters.find(c => c.id === fallbackPkg.ThumbnailResource!.Id);
              if (thumbResourceChar?.thumbnail) {
                fallbackThumbSource = thumbResourceChar;
                console.log(`[Upload] Using ThumbnailResource character ${fallbackPkg.ThumbnailResource.Id} for thumbnail (fallback)`);
              }
            }

            if (fallbackThumbSource.thumbnail) {
              mainImage = Buffer.from(fallbackThumbSource.thumbnail as Uint8Array);
            }

            // Extract assets from Voxta character
            if (extractedChar.assets && extractedChar.assets.length > 0) {
              extractedAssets = convertVoxtaAssets(extractedChar.assets);
              console.log(`[Upload] Extracted ${extractedAssets.length} assets from Voxta fallback`);
            }
            // Skip the rest of parseCard handling
            // Jump to ID generation (handled below after if/else)
          } else {
            // Voxta parsing failed - include debug info in error
            const reason = lastVoxtaError || (voxtaDataForSingleChar ? 'parsed but 0 chars' : 'unknown');
            throw new Error(`${errorMessage} (Voxta fallback failed: ${reason})`);
          }
        } else {
          throw parseError;
        }
      }

      // Only process parseResult if we didn't handle Voxta above
      if (parseResult) {
        const cardData = parseResult.card.data;

        // Find main image from assets
        // loader 0.1.1+ provides isMain icon with tEXt chunks stripped (clean PNG for thumbnails)
        // For V2 cards without assets, mainImage will be undefined - that's OK, upload proceeds without image
        const mainAsset = parseResult.assets.find(a => a.isMain && a.type === 'icon');
        if (mainAsset?.data) {
          mainImage = Buffer.from(mainAsset.data as Uint8Array);
        }

        // Convert non-main assets to our format
        extractedAssets = parseResult.assets
          .filter(a => !a.isMain || a.type !== 'icon')
          .map(a => ({
            name: a.name,
            type: a.type,
            ext: a.ext,
            buffer: Buffer.from(a.data as Uint8Array),
            path: a.path,
          }));

        // ALWAYS compute tokens and metadata server-side (never trust client)
        // Client metadata is only used for non-security-sensitive display fields
        {
          // Full server-side parsing (fallback for clients without JS)
          const tokens = countCardTokens(cardData);

          // Extract card metadata using canonical implementation
          const metadata = extractCardMetadata(cardData);

          // Map container format to source format
          const sourceFormat = parseResult.containerFormat === 'unknown' ? 'json' : parseResult.containerFormat;

          parsedCard = {
            name: cardData.name || 'Unknown',
            description: cardData.description || '',
            creator: cardData.creator || '',
            creatorNotes: cardData.creator_notes || '',
            specVersion: parseResult.spec === 'v3' ? 'v3' : 'v2',
            sourceFormat: sourceFormat as 'png' | 'json' | 'charx' | 'voxta',
            tokens,
            metadata: {
              hasAlternateGreetings: metadata.hasAlternateGreetings,
              alternateGreetingsCount: metadata.alternateGreetingsCount,
              hasLorebook: metadata.hasLorebook,
              lorebookEntriesCount: metadata.lorebookEntriesCount,
              hasEmbeddedImages: metadata.hasEmbeddedImages,
              embeddedImagesCount: metadata.embeddedImagesCount,
            },
            tags: cardData.tags || [],
            raw: parseResult.card,
          };
        }
      }
    }

    // Generate IDs
    const id = generateId();
    const slug = generateSlug(parsedCard.name);

    // Save image and assets
    let imagePath: string | null = null;
    let imageWidth: number | null = null;
    let imageHeight: number | null = null;
    let thumbnailPath: string | null = null;
    let thumbnailWidth: number | null = null;
    let thumbnailHeight: number | null = null;
    let savedAssetsData: Array<{ name: string; type: string; ext: string; path: string; thumbnailPath?: string }> = [];

    // Store the original uploaded file using storage abstraction
    const storageUrl = await store(buffer, `cards/${id}${ext}`);

    // Save main image to /uploads/{id}.png (same location for all formats)
    if (mainImage) {
      // Store main image via storage abstraction
      const imageName = `${id}.png`;
      await store(mainImage, imageName);

      // Get public URL for the stored image
      imagePath = isCloudflareRuntime()
        ? getPublicUrl(`r2://${imageName}`)
        : getPublicUrl(`file:///${imageName}`);

      // Get image dimensions from PNG header
      if (mainImage.length > 24) {
        imageWidth = mainImage.readUInt32BE(16);
        imageHeight = mainImage.readUInt32BE(20);
      }

      // Generate and store thumbnail (processed once, served directly)
      try {
        const thumbPath = await processThumbnail(new Uint8Array(mainImage), id, 'main');
        thumbnailPath = `/api/uploads/${thumbPath}`;
        // Thumbnail dimensions after processing (500x750 for main)
        thumbnailWidth = 500;
        thumbnailHeight = 750;
      } catch (error) {
        console.error('Failed to generate thumbnail:', error);
        // Fallback: serve original image
        thumbnailPath = imagePath;
        thumbnailWidth = imageWidth;
        thumbnailHeight = imageHeight;
      }
    }

    // Save extracted assets (charx/voxta packages only)
    if (extractedAssets.length > 0) {
      try {
        // saveAssets now uses store() internally and handles thumbnails logic
        const assetsResult = await saveAssets(id, extractedAssets);

        savedAssetsData = assetsResult.assets.map(a => ({
          name: a.name,
          type: a.type,
          ext: a.ext,
          path: a.path,
          thumbnailPath: a.thumbnailPath,
        }));
      } catch (error) {
        console.error('Failed to save assets:', error);
      }
    }

    // Use the card's actual tags + any user-provided tags
    // Tags will be created in the database if they don't exist
    const allTags = [...new Set([...parsedCard.tags, ...tagSlugs])];

    // Normalize tags to slugs for blocked tag check
    const allTagSlugs = allTags.map(tag =>
      tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    );

    // Check for blocked tags
    const blockedTagNames = await checkBlockedTags(allTagSlugs);
    if (blockedTagNames.length > 0) {
      return NextResponse.json(
        {
          error: `Upload rejected: Card contains blocked tags: ${blockedTagNames.join(', ')}`,
          blockedTags: blockedTagNames,
        },
        { status: 400 }
      );
    }

    // Determine actual assets count (from extracted assets, not just card data)
    const actualAssetsCount = savedAssetsData.length || extractedAssets.length;
    const hasActualAssets = actualAssetsCount > 0;

    // ASYNC IMAGE PROCESSING: Don't process embedded images during upload
    // This was causing 30-50 second upload times for cards with external images
    // Instead, we'll process them async after upload via /api/cards/[slug]/process-images
    const displayCardData = parsedCard.raw;

    // Enforce card data size limit (10MB max for cardData JSON)
    const cardDataJson = JSON.stringify(displayCardData);
    const MAX_CARD_DATA_SIZE = 10 * 1024 * 1024; // 10MB
    if (cardDataJson.length > MAX_CARD_DATA_SIZE) {
      return NextResponse.json(
        { error: `Card data exceeds maximum size limit (${Math.round(MAX_CARD_DATA_SIZE / 1024 / 1024)}MB)` },
        { status: 400 }
      );
    }

    // Create card with initial version in database
    // Note: createCard is still synchronous/sqlite, needs refactoring next
    const { cardId, versionId } = await createCard({
      id,
      slug,
      name: parsedCard.name,
      description: parsedCard.description || null,
      creator: parsedCard.creator || null,
      creatorNotes: parsedCard.creatorNotes || null,
      uploaderId: session.user.id,
      visibility: visibility as 'public' | 'private' | 'nsfw_only' | 'unlisted',
      tagSlugs: allTags,
      version: {
        storageUrl,
        contentHash,
        specVersion: parsedCard.specVersion,
        sourceFormat: parsedCard.sourceFormat,
        tokens: parsedCard.tokens,
        hasAltGreetings: parsedCard.metadata.hasAlternateGreetings,
        altGreetingsCount: parsedCard.metadata.alternateGreetingsCount,
        hasLorebook: parsedCard.metadata.hasLorebook,
        lorebookEntriesCount: parsedCard.metadata.lorebookEntriesCount,
        hasEmbeddedImages: parsedCard.metadata.hasEmbeddedImages,
        embeddedImagesCount: parsedCard.metadata.embeddedImagesCount,
        hasAssets: hasActualAssets,
        assetsCount: actualAssetsCount,
        savedAssets: savedAssetsData.length > 0 ? JSON.stringify(savedAssetsData) : null,
        imagePath,
        imageWidth,
        imageHeight,
        thumbnailPath,
        thumbnailWidth,
        thumbnailHeight,
        cardData: cardDataJson,
      },
    });

    // NOTE: Image processing disabled temporarily to avoid 503 errors
    // User can manually trigger processing via /api/cards/[slug]/process-images
    // Card page will show "processing" state with refresh button
    console.log(`[ImageProcessing] Card uploaded: ${slug} - processing can be triggered manually`);

    // Invalidate listing caches so new card appears in results
    await cacheDeleteByPrefix(CACHE_PREFIX.CARDS);

    return NextResponse.json({
      success: true,
      data: {
        id: cardId,
        slug,
        name: parsedCard.name,
        versionId,
      },
    });
  } catch (error) {
    console.error('Error uploading card:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload card' },
      { status: 500 }
    );
  }
}// Cache bust: 1765244043
