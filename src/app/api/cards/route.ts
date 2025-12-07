import { NextRequest, NextResponse } from 'next/server';
import { getCards, createCard, computeContentHash, checkBlockedTags } from '@/lib/db/cards';
import { parseCard, type ParseResult, type ExtractedAsset } from '@character-foundry/loader';
import { toUint8Array } from '@character-foundry/core';
import { countCardTokens } from '@/lib/client/tokenizer';
import { generateThumbnailBuffer } from '@/lib/image/thumbnail';
import { saveAssets } from '@/lib/image';
import { generateId, generateSlug } from '@/lib/utils';
import { store, getPublicUrl } from '@/lib/storage';
import { getSession } from '@/lib/auth';
import { isCloudflareRuntime } from '@/lib/db';
import {
  parseQuery,
  CardFiltersSchema,
  CardFileSchema,
  UploadVisibilitySchema,
} from '@/lib/validations';
import type { CardFilters } from '@/types/card';

// Use shared utility for counting embedded images
import { countEmbeddedImages } from '@/lib/card-metadata';

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

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
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

    // Check for client-provided metadata (client-side parsing)
    let clientMetadata: ClientMetadata | null = null;
    if (metadataJson) {
      try {
        clientMetadata = JSON.parse(metadataJson);
      } catch {
        console.warn('Invalid client metadata, falling back to server-side parsing');
      }
    }

    // Use client-provided content hash or compute server-side
    const contentHash = clientMetadata?.contentHash || computeContentHash(buffer);

    // Parse card data - use client metadata if available, otherwise parse server-side
    let parsedCard: {
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

    // Parse card using character-foundry loader
    const parseResult = parseCard(toUint8Array(buffer), { extractAssets: true });
    const cardData = parseResult.card.data;

    // Find main image from assets - prefer small embedded icons over huge PNG containers
    // For PNGs with embedded assets, look for iconx or similar small icon first
    const smallIcon = parseResult.assets.find(a =>
      a.type === 'icon' &&
      !a.isMain &&
      a.data &&
      a.data.length < 5 * 1024 * 1024 // Under 5MB
    );

    if (smallIcon?.data) {
      // Use small embedded icon (e.g., iconx at ~30-50KB)
      mainImage = Buffer.from(smallIcon.data as Uint8Array);
    } else if (parseResult.containerFormat === 'png') {
      // Fallback to raw PNG if no small icon found
      mainImage = Buffer.from(parseResult.rawBuffer as Uint8Array);
    } else {
      // For non-PNG formats, use main icon asset
      const mainAsset = parseResult.assets.find(a => a.isMain && a.type === 'icon');
      if (mainAsset?.data) {
        mainImage = Buffer.from(mainAsset.data as Uint8Array);
      }
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

    if (clientMetadata) {
      // Use client-parsed metadata (reduces server CPU usage)
      parsedCard = {
        name: clientMetadata.name,
        description: clientMetadata.description,
        creator: clientMetadata.creator,
        creatorNotes: clientMetadata.creatorNotes,
        specVersion: clientMetadata.specVersion,
        sourceFormat: clientMetadata.sourceFormat,
        tokens: clientMetadata.tokens,
        metadata: clientMetadata.metadata,
        tags: clientMetadata.tags,
        raw: JSON.parse(clientMetadata.cardData),
      };
    } else {
      // Full server-side parsing (fallback for clients without JS)
      const tokens = countCardTokens(cardData);

      // Count embedded images
      const embeddedImages = countEmbeddedImages([
        cardData.description,
        cardData.first_mes,
        ...(cardData.alternate_greetings || []),
        cardData.mes_example,
        cardData.creator_notes || '',
      ]);

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
          hasAlternateGreetings: (cardData.alternate_greetings?.length || 0) > 0,
          alternateGreetingsCount: cardData.alternate_greetings?.length || 0,
          hasLorebook: !!(cardData.character_book?.entries?.length),
          lorebookEntriesCount: cardData.character_book?.entries?.length || 0,
          hasEmbeddedImages: embeddedImages > 0,
          embeddedImagesCount: embeddedImages,
        },
        tags: cardData.tags || [],
        raw: parseResult.card,
      };
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

      // Generate thumbnail
      if (isCloudflareRuntime()) {
        // On Cloudflare: Use /api/thumb/ route which applies cf.image transformations
        thumbnailPath = `/api/thumb/${imageName}?type=main`;
        // Estimate thumbnail dimensions (500px portrait width)
        const isLandscape = imageWidth && imageHeight && imageWidth > imageHeight;
        thumbnailWidth = isLandscape ? 750 : 500;
        thumbnailHeight = isLandscape
          ? Math.round((imageHeight! * 750) / imageWidth!)
          : Math.round((imageHeight! * 500) / imageWidth!);
      } else {
        // On Node.js: Generate and store WebP thumbnail with Sharp
        try {
          const thumbResult = await generateThumbnailBuffer(mainImage, 'main');
          const thumbName = `thumbnails/${id}.webp`;
          await store(thumbResult.buffer, thumbName);

          thumbnailPath = getPublicUrl(`file:///${thumbName}`);
          thumbnailWidth = thumbResult.width;
          thumbnailHeight = thumbResult.height;
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
          // Fallback to /api/thumb/ route
          thumbnailPath = `/api/thumb/${imageName}?type=main`;
          const isLandscape = imageWidth && imageHeight && imageWidth > imageHeight;
          thumbnailWidth = isLandscape ? 750 : 500;
          thumbnailHeight = isLandscape && imageWidth && imageHeight
            ? Math.round((imageHeight * 750) / imageWidth)
            : imageWidth && imageHeight
              ? Math.round((imageHeight * 500) / imageWidth)
              : 750;
        }
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
        cardData: JSON.stringify(parsedCard.raw),
      },
    });

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
}