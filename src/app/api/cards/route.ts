import { NextRequest, NextResponse } from 'next/server';
import { getCards, createCard, computeContentHash } from '@/lib/db/cards';
import { parseFromBufferWithAssets } from '@/lib/card-parser';
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
  CardUploadMetadataSchema,
  UploadVisibilitySchema,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from '@/lib/validations';
import type { CardFilters } from '@/types/card';

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

    const result = await getCards(filters);

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
        { error: `Invalid visibility. Must be one of: public, nsfw_only, unlisted` },
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

      // Still need to extract image/assets from the file for storage
      // Do minimal parsing just for binary data
      const parseResult = parseFromBufferWithAssets(buffer, file.name);
      mainImage = parseResult.mainImage;
      extractedAssets = parseResult.extractedAssets;
    } else {
      // Full server-side parsing (fallback for clients without JS)
      const parseResult = parseFromBufferWithAssets(buffer, file.name);
      const card = parseResult.card;

      parsedCard = {
        name: card.name,
        description: card.description,
        creator: card.creator,
        creatorNotes: card.creatorNotes,
        specVersion: card.specVersion,
        sourceFormat: card.sourceFormat,
        tokens: card.tokens,
        metadata: card.metadata,
        tags: card.tags,
        raw: card.raw,
      };
      mainImage = parseResult.mainImage;
      extractedAssets = parseResult.extractedAssets;
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
        // On Cloudflare, use CF Image Resizing URL format
        // Assumption: The frontend or proxy handles the /cdn-cgi/image/ construction
        // OR we return the configured URL here.
        // Using format: /cdn-cgi/image/width=500,format=webp/URL
        // Since we have the imagePath (which is a public URL), we can prefix it.
        thumbnailPath = `/cdn-cgi/image/width=500,format=webp${imagePath}`;
        // Dimensions are approximate or unknown until resized
        thumbnailWidth = 500;
        thumbnailHeight = imageWidth && imageHeight ? Math.round((imageHeight * 500) / imageWidth) : 500;
      } else {
        // Local: Generate thumbnail buffer
        try {
          const thumbResult = await generateThumbnailBuffer(mainImage, 'main');
          const thumbName = `thumbnails/${id}.webp`;
          await store(thumbResult.buffer, thumbName);
          
          thumbnailPath = getPublicUrl(`file:///${thumbName}`);
          thumbnailWidth = thumbResult.width;
          thumbnailHeight = thumbResult.height;
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
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
      visibility: visibility as 'public' | 'nsfw_only' | 'unlisted',
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