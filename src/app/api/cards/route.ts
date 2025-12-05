import { NextRequest, NextResponse } from 'next/server';
import { getCards, createCard, computeContentHash } from '@/lib/db/cards';
import { parseFromBufferWithAssets } from '@/lib/card-parser';
import { generateThumbnail, saveAssets } from '@/lib/image';
import { generateId, generateSlug } from '@/lib/utils';
import { store } from '@/lib/storage';
import { getSession } from '@/lib/auth';
import { isCloudflareRuntime } from '@/lib/db';
import type { CardFilters } from '@/types/card';

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.png', '.json', '.charx', '.voxpkg'];

// Max file size (50MB for Cloudflare deployment)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

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
    const searchParams = request.nextUrl.searchParams;

    const filters: CardFilters = {
      search: searchParams.get('search') || undefined,
      tags: searchParams.get('tags')?.split(',').filter(Boolean) || undefined,
      excludeTags: searchParams.get('excludeTags')?.split(',').filter(Boolean) || undefined,
      sort: (searchParams.get('sort') as CardFilters['sort']) || 'newest',
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: Math.min(parseInt(searchParams.get('limit') || '24', 10), 100),
      minTokens: searchParams.get('minTokens') ? parseInt(searchParams.get('minTokens')!, 10) : undefined,
      maxTokens: searchParams.get('maxTokens') ? parseInt(searchParams.get('maxTokens')!, 10) : undefined,
      hasAltGreetings: searchParams.get('hasAltGreetings') === 'true',
      hasLorebook: searchParams.get('hasLorebook') === 'true',
      hasEmbeddedImages: searchParams.get('hasEmbeddedImages') === 'true',
    };

    const result = getCards(filters);

    return NextResponse.json(result);
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
    const visibility = (formData.get('visibility') as string) || 'public';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check file size (server-side validation)
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size must be less than 50MB` },
        { status: 400 }
      );
    }

    // Check file extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Invalid file type. Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate visibility
    const validVisibility = ['public', 'nsfw_only', 'unlisted'];
    if (!validVisibility.includes(visibility)) {
      return NextResponse.json(
        { error: `Invalid visibility. Must be one of: ${validVisibility.join(', ')}` },
        { status: 400 }
      );
    }

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
      imagePath = `/${imageName}`;

      // Get image dimensions from PNG header
      if (mainImage.length > 24) {
        imageWidth = mainImage.readUInt32BE(16);
        imageHeight = mainImage.readUInt32BE(20);
      }

      // Generate thumbnail (local only - Cloudflare uses on-demand resizing)
      if (!isCloudflareRuntime()) {
        try {
          const { join } = await import('path');
          const { mkdirSync, existsSync } = await import('fs');

          const uploadsDir = join(process.cwd(), 'uploads');
          const thumbnailsDir = join(uploadsDir, 'thumbnails');

          if (!existsSync(uploadsDir)) {
            mkdirSync(uploadsDir, { recursive: true });
          }
          if (!existsSync(thumbnailsDir)) {
            mkdirSync(thumbnailsDir, { recursive: true });
          }

          const thumbnail = await generateThumbnail(
            mainImage,
            join(thumbnailsDir, id),
            'main'
          );
          thumbnailPath = `/uploads/thumbnails/${id}.webp`;
          thumbnailWidth = thumbnail.width;
          thumbnailHeight = thumbnail.height;
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
        }
      }
    }

    // Save extracted assets (charx/voxta packages only) - local only
    // On Cloudflare, assets are stored directly in R2
    if (extractedAssets.length > 0 && !isCloudflareRuntime()) {
      try {
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
    const { cardId, versionId } = createCard({
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
