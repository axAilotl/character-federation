/**
 * Shared card metadata utilities
 * Single source of truth for counting embedded images, greetings, etc.
 *
 * Related packages:
 * - @character-foundry/schemas: DerivedFeatures type, hasLorebook() function
 * - @character-foundry/lorebook: Lorebook manipulation utilities
 * - @character-foundry/loader: validateClientMetadata() for server-side validation
 */

import type { CCv3CharacterBook } from '@character-foundry/schemas';

/**
 * Count embedded images in text fields (markdown images, HTML images, data URIs)
 */
export function countEmbeddedImages(texts: (string | undefined)[]): number {
  let count = 0;
  const patterns = [
    /!\[.*?\]\(.*?\)/g,                              // Markdown images
    /<img[^>]+src=["'][^"']+["'][^>]*>/gi,          // HTML images
    /data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g,   // Data URIs
  ];
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) count += matches.length;
    }
  }
  return count;
}

/**
 * Extract card metadata from card data
 * Use this for consistent metadata across client and server
 *
 * Note: This is a subset of DerivedFeatures from @character-foundry/schemas.
 * For full feature extraction including Risu extensions, depth prompts, etc.,
 * see the DerivedFeatures type and createEmptyFeatures() function.
 */
export interface CardMetadataCounts {
  hasAlternateGreetings: boolean;
  alternateGreetingsCount: number;
  /** Total greetings = first_mes (1) + alternate_greetings */
  totalGreetingsCount: number;
  hasLorebook: boolean;
  lorebookEntriesCount: number;
  hasEmbeddedImages: boolean;
  embeddedImagesCount: number;
}

export function extractCardMetadata(data: {
  description?: string;
  first_mes?: string;
  alternate_greetings?: string[];
  mes_example?: string;
  creator_notes?: string;
  character_book?: CCv3CharacterBook | null;
}): CardMetadataCounts {
  const embeddedImages = countEmbeddedImages([
    data.description,
    data.first_mes,
    ...(data.alternate_greetings || []),
    data.mes_example,
    data.creator_notes || '',
  ]);

  const alternateGreetingsCount = data.alternate_greetings?.length || 0;
  const lorebookEntriesCount = data.character_book?.entries?.length ?? 0;

  return {
    hasAlternateGreetings: alternateGreetingsCount > 0,
    alternateGreetingsCount,
    // Total = first message + alternates
    totalGreetingsCount: alternateGreetingsCount + 1,
    hasLorebook: lorebookEntriesCount > 0,
    lorebookEntriesCount,
    hasEmbeddedImages: embeddedImages > 0,
    embeddedImagesCount: embeddedImages,
  };
}
