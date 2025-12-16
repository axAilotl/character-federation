/**
 * Durable Object for processing card images asynchronously
 *
 * This runs independently of the HTTP request lifecycle, ensuring
 * image processing completes even after the Worker returns a response.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '@/types/env';

interface ProcessImageRequest {
  cardId: string;
  versionId: string;
  cardData: Record<string, unknown>;
  slug: string;
}

export class ImageProcessor extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/process' && request.method === 'POST') {
      return this.processImages(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async processImages(request: Request): Promise<Response> {
    try {
      const data: ProcessImageRequest = await request.json();
      const { cardId, versionId, cardData, slug } = data;

      console.log(`[ImageProcessor DO] Starting processing for card ${slug}`);

      // Import processing function dynamically (avoid bundling issues)
      const { processCardImages } = await import('@/lib/image/process');
      const { updateCardVersion } = await import('@/lib/db/cards');

      // Process embedded images (downloads external URLs, converts to WebP, uploads to R2)
      const { displayData, urlMapping } = await processCardImages(cardData, cardId);

      if (urlMapping.size > 0) {
        console.log(`[ImageProcessor DO] Processed ${urlMapping.size} embedded images for card ${slug}`);

        // Update database with rewritten URLs
        await updateCardVersion(versionId, { cardData: displayData });

        return new Response(JSON.stringify({
          success: true,
          processedImages: urlMapping.size,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        console.log(`[ImageProcessor DO] No embedded images found for card ${slug}`);
        return new Response(JSON.stringify({
          success: true,
          processedImages: 0,
          message: 'No embedded images to process',
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      console.error('[ImageProcessor DO] Error:', error);
      return new Response(JSON.stringify({
        error: 'Processing failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
