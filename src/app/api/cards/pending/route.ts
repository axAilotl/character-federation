/**
 * POST /api/cards/pending
 *
 * Create a pending card for large file uploads.
 * Client sends extracted metadata + thumbnail, server creates card immediately.
 * Returns uploadId for multipart upload of the original file.
 *
 * Request body (FormData):
 * - metadata: JSON string with card info
 * - thumbnail: PNG file (optional)
 *
 * Response:
 * - cardId: ID of created card
 * - uploadId: R2 multipart upload ID for chunks
 * - r2Key: The key where the file will be stored
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { z } from 'zod';
import { getR2 } from '@/lib/cloudflare/env';
import { getDatabase } from '@/lib/db/async-db';
import { generateId, generateSlug } from '@/lib/utils';
import { processThumbnail } from '@/lib/image/process';
import { isCloudflareRuntime } from '@/lib/db';
import { getPublicUrl } from '@/lib/storage';

// Metadata schema
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

const MetadataFlagsSchema = z.object({
  hasAlternateGreetings: z.boolean(),
  alternateGreetingsCount: z.number().int().nonnegative(),
  hasLorebook: z.boolean(),
  lorebookEntriesCount: z.number().int().nonnegative(),
  hasEmbeddedImages: z.boolean(),
  embeddedImagesCount: z.number().int().nonnegative(),
  hasAssets: z.boolean().optional(),
  assetsCount: z.number().int().nonnegative().optional(),
});

const PendingMetadataSchema = z.object({
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
  cardData: z.string().min(1), // JSON stringified card data
  // For large files
  fileSize: z.number().int().positive(),
  fileExtension: z.string().min(1),
  // Asset manifest for later processing
  assetManifest: z.array(z.object({
    name: z.string(),
    path: z.string(),
    size: z.number(),
    type: z.string().optional(),
  })).optional(),
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

    // Get R2 binding
    const r2 = await getR2();
    if (!r2) {
      return NextResponse.json(
        { error: 'Storage not available' },
        { status: 503 }
      );
    }

    // Parse FormData
    const formData = await request.formData();
    const metadataStr = formData.get('metadata');
    const thumbnailFile = formData.get('thumbnail') as File | null;
    const visibilityStr = formData.get('visibility') as string || 'public';

    if (!metadataStr || typeof metadataStr !== 'string') {
      return NextResponse.json(
        { error: 'Missing metadata' },
        { status: 400 }
      );
    }

    // Parse and validate metadata
    let metadataJson;
    try {
      metadataJson = JSON.parse(metadataStr);
    } catch {
      return NextResponse.json(
        { error: 'Invalid metadata JSON' },
        { status: 400 }
      );
    }

    const parsed = PendingMetadataSchema.safeParse(metadataJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid metadata', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const metadata = parsed.data;
    const visibility = ['public', 'private', 'unlisted'].includes(visibilityStr)
      ? visibilityStr as 'public' | 'private' | 'unlisted'
      : 'public';

    // Generate IDs
    const cardId = generateId();
    const slug = generateSlug(metadata.name);
    const versionId = generateId();

    // Determine file extension and R2 key
    const ext = metadata.fileExtension.startsWith('.')
      ? metadata.fileExtension
      : `.${metadata.fileExtension}`;
    const r2Key = `cards/${cardId}${ext}`;

    // Start R2 multipart upload
    const multipartUpload = await r2.createMultipartUpload(r2Key);
    const uploadId = multipartUpload.uploadId;

    // Process thumbnail if provided
    let imagePath: string | null = null;
    let imageWidth: number | null = null;
    let imageHeight: number | null = null;
    let thumbnailPath: string | null = null;
    let thumbnailWidth: number | null = null;
    let thumbnailHeight: number | null = null;

    if (thumbnailFile && thumbnailFile.size > 0) {
      const thumbBuffer = Buffer.from(await thumbnailFile.arrayBuffer());

      // Store main image
      const imageKey = `${cardId}.png`;
      await r2.put(imageKey, thumbBuffer);

      imagePath = isCloudflareRuntime()
        ? getPublicUrl(`r2://${imageKey}`)
        : getPublicUrl(`file:///${imageKey}`);

      // Get dimensions from PNG header
      if (thumbBuffer.length > 24) {
        imageWidth = thumbBuffer.readUInt32BE(16);
        imageHeight = thumbBuffer.readUInt32BE(20);
      }

      // Generate thumbnail
      try {
        const thumbPath = await processThumbnail(new Uint8Array(thumbBuffer), cardId, 'main');
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

    // Create card and version records with pending status
    const db = await getDatabase();
    const now = Math.floor(Date.now() / 1000);

    // Create card record
    await db.prepare(`
      INSERT INTO cards (
        id, slug, name, description, creator, creator_notes,
        head_version_id, visibility, uploader_id,
        processing_status, upload_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      cardId,
      slug,
      metadata.name,
      metadata.description || null,
      metadata.creator || null,
      metadata.creatorNotes || null,
      versionId,
      visibility,
      session.user.id,
      uploadId,
      now,
      now
    );

    // Create version record (storage_url will be set after upload completes)
    await db.prepare(`
      INSERT INTO card_versions (
        id, card_id, storage_url, content_hash,
        spec_version, source_format,
        tokens_description, tokens_personality, tokens_scenario,
        tokens_mes_example, tokens_first_mes, tokens_system_prompt,
        tokens_post_history, tokens_total,
        has_alt_greetings, alt_greetings_count,
        has_lorebook, lorebook_entries_count,
        has_embedded_images, embedded_images_count,
        has_assets, assets_count,
        image_path, image_width, image_height,
        thumbnail_path, thumbnail_width, thumbnail_height,
        card_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      cardId,
      '', // Will be updated after upload completes
      metadata.contentHash,
      metadata.specVersion,
      metadata.sourceFormat,
      metadata.tokens.description,
      metadata.tokens.personality,
      metadata.tokens.scenario,
      metadata.tokens.mesExample,
      metadata.tokens.firstMes,
      metadata.tokens.systemPrompt,
      metadata.tokens.postHistory,
      metadata.tokens.total,
      metadata.metadata.hasAlternateGreetings ? 1 : 0,
      metadata.metadata.alternateGreetingsCount,
      metadata.metadata.hasLorebook ? 1 : 0,
      metadata.metadata.lorebookEntriesCount,
      metadata.metadata.hasEmbeddedImages ? 1 : 0,
      metadata.metadata.embeddedImagesCount,
      metadata.metadata.hasAssets ? 1 : 0,
      metadata.metadata.assetsCount || 0,
      imagePath,
      imageWidth,
      imageHeight,
      thumbnailPath,
      thumbnailWidth,
      thumbnailHeight,
      metadata.cardData,
      now
    );

    // Handle tags
    if (metadata.tags.length > 0) {
      for (const tag of metadata.tags) {
        const tagSlug = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!tagSlug) continue;

        // Insert or get tag
        await db.prepare(`
          INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)
        `).run(tag, tagSlug);

        const tagRow = await db.prepare(`
          SELECT id FROM tags WHERE slug = ?
        `).get(tagSlug) as { id: number } | undefined;

        if (tagRow) {
          await db.prepare(`
            INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?, ?)
          `).run(cardId, tagRow.id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      cardId,
      slug,
      versionId,
      uploadId,
      r2Key,
    });
  } catch (error) {
    console.error('Error creating pending card:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create pending card' },
      { status: 500 }
    );
  }
}
