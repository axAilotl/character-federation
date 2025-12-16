/**
 * Client-side card parser using character-foundry packages
 */
import { parseCard, type ParseResult } from '@character-foundry/character-foundry/loader';
import { isVoxta, readVoxta } from '@character-foundry/character-foundry/voxta';
import { toUint8Array } from '@character-foundry/character-foundry/core';
import type { CCv3Data, CCv3CharacterBook } from '@character-foundry/character-foundry/schemas';
import { countCardTokens, type TokenCounts } from './tokenizer';

export type SourceFormat = 'png' | 'json' | 'charx' | 'voxta';

export interface CardMetadata {
  hasAlternateGreetings: boolean;
  alternateGreetingsCount: number;
  hasLorebook: boolean;
  lorebookEntriesCount: number;
  hasEmbeddedImages: boolean;
  embeddedImagesCount: number;
}

export interface ParsedCard {
  raw: CCv3Data;
  specVersion: 'v2' | 'v3';
  sourceFormat: SourceFormat;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
  tokens: TokenCounts;
  metadata: CardMetadata;
  lorebook?: CCv3CharacterBook | null;
}

export interface ExtractedAsset {
  name: string;
  type: string;
  ext: string;
  buffer: Uint8Array;
  path?: string;
}

export interface ParseResultWithAssets {
  card: ParsedCard;
  extractedAssets: ExtractedAsset[];
  mainImage?: Uint8Array;
  /** True if this is a multi-character Voxta package (server handles as collection) */
  isMultiCharPackage?: boolean;
  /** Number of characters in package (for multi-char Voxta) */
  packageCharCount?: number;
  /** Package name (for multi-char Voxta) */
  packageName?: string;
}

// Use shared utility for counting embedded images
import { extractCardMetadata } from '@/lib/card-metadata';

/**
 * Convert character-foundry ParseResult to CardsHub ParsedCard
 */
function toParsedCard(result: ParseResult): ParsedCard {
  const card = result.card;
  const data = card.data;

  // Calculate token counts
  const tokens = countCardTokens(data);

  // Extract metadata using shared utility (single source of truth)
  const metadata = extractCardMetadata(data);

  // Map source format
  let sourceFormat: SourceFormat;
  switch (result.containerFormat) {
    case 'png':
      sourceFormat = 'png';
      break;
    case 'charx':
      sourceFormat = 'charx';
      break;
    case 'voxta':
      sourceFormat = 'voxta';
      break;
    case 'json':
    default:
      sourceFormat = 'json';
      break;
  }

  return {
    raw: card,
    specVersion: result.spec === 'v3' ? 'v3' : 'v2',
    sourceFormat,
    name: data.name || 'Unknown',
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    firstMessage: data.first_mes || '',
    messageExample: data.mes_example || '',
    creatorNotes: data.creator_notes || '',
    systemPrompt: data.system_prompt || '',
    postHistoryInstructions: data.post_history_instructions || '',
    alternateGreetings: data.alternate_greetings || [],
    tags: data.tags || [],
    creator: data.creator || '',
    characterVersion: data.character_version || '',
    tokens,
    metadata,
    lorebook: data.character_book,
  };
}

/**
 * Parse a character card from any supported format (client-side)
 */
export function parseFromBuffer(buffer: Uint8Array, filename?: string): ParsedCard {
  const result = parseFromBufferWithAssets(buffer);
  return result.card;
}

/**
 * Parse a character card and extract all binary assets
 */
export function parseFromBufferWithAssets(buffer: Uint8Array): ParseResultWithAssets {
  const uint8 = toUint8Array(buffer);

  // Check for multi-character Voxta package FIRST
  // These need special handling - server creates a collection instead of single card
  if (isVoxta(uint8)) {
    try {
      const voxtaData = readVoxta(uint8, { maxFileSize: 50 * 1024 * 1024 });
      // Multi-character packages should create collections
      // Note: Some Voxta exports don't have package.json (exportType: 'character')
      if (voxtaData.characters.length >= 2) {
        // Multi-char package - return minimal info, let server handle it
        // We still parse the first char for preview purposes
        const result = parseCard(uint8, { extractAssets: true });
        const card = toParsedCard(result);

        // Get main image from ThumbnailResource if specified, otherwise first character
        // ThumbnailResource.Kind: 3 = Character
        let mainImage: Uint8Array | undefined;
        const pkg = voxtaData.package;

        if (pkg?.ThumbnailResource?.Id) {
          // Look up the character specified by ThumbnailResource
          const thumbChar = voxtaData.characters.find(c => c.id === pkg.ThumbnailResource!.Id);
          if (thumbChar?.thumbnail) {
            mainImage = thumbChar.thumbnail instanceof Uint8Array
              ? thumbChar.thumbnail
              : new Uint8Array(thumbChar.thumbnail as ArrayBuffer);
            console.log(`[card-parser] Using ThumbnailResource character ${pkg.ThumbnailResource.Id} for preview`);
          }
        }

        // Fallback to main icon from parseCard result
        if (!mainImage) {
          const mainAsset = result.assets.find(a => a.isMain && a.type === 'icon');
          if (mainAsset?.data) {
            mainImage = mainAsset.data instanceof Uint8Array
              ? mainAsset.data
              : new Uint8Array(mainAsset.data as ArrayBuffer);
          }
        }

        return {
          card,
          extractedAssets: [],
          mainImage,
          isMultiCharPackage: true,
          packageCharCount: voxtaData.characters.length,
          packageName: voxtaData.package?.Name || `${voxtaData.characters.length} Characters`,
        };
      }
    } catch (error) {
      // Log error for debugging, then fall through to normal parsing
      console.error('[card-parser] Multi-char Voxta detection failed:', error);
    }
  }

  const result = parseCard(uint8, { extractAssets: true });

  const card = toParsedCard(result);

  // Find main image from isMain icon asset
  // loader 0.1.1+ provides isMain icon with tEXt chunks stripped (clean PNG for thumbnails)
  // For V2 cards without assets, mainImage will be undefined - that's OK
  let mainImage: Uint8Array | undefined;
  const mainAsset = result.assets.find(a => a.isMain && a.type === 'icon');
  if (mainAsset?.data) {
    mainImage = mainAsset.data instanceof Uint8Array
      ? mainAsset.data
      : new Uint8Array(mainAsset.data as ArrayBuffer);
  }

  // Convert non-main assets
  const extractedAssets: ExtractedAsset[] = result.assets
    .filter(a => !a.isMain || a.type !== 'icon')
    .map(a => ({
      name: a.name,
      type: a.type,
      ext: a.ext,
      buffer: a.data instanceof Uint8Array ? a.data : new Uint8Array(a.data as ArrayBuffer),
      path: a.path,
    }));

  return {
    card,
    extractedAssets,
    mainImage,
  };
}

/**
 * Parse from JSON string
 */
export function parseFromJson(jsonString: string): ParsedCard {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(jsonString);
  return parseFromBuffer(buffer);
}

/**
 * Compute SHA-256 hash of a buffer (browser-compatible)
 * Falls back to a simple hash if crypto.subtle is not available (non-HTTPS)
 */
export async function computeContentHash(buffer: Uint8Array): Promise<string> {
  // crypto.subtle only available in secure contexts (HTTPS or localhost)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
      const copy = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(copy).set(buffer);
      const hashBuffer = await crypto.subtle.digest('SHA-256', copy);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: simple hash for non-secure contexts (development)
  let hash = 5381;
  for (let i = 0; i < buffer.length; i++) {
    hash = ((hash << 5) + hash) ^ buffer[i];
    hash = hash >>> 0;
  }
  const sample = [
    buffer[0] || 0,
    buffer[Math.floor(buffer.length / 4)] || 0,
    buffer[Math.floor(buffer.length / 2)] || 0,
    buffer[Math.floor(buffer.length * 3 / 4)] || 0,
    buffer[buffer.length - 1] || 0,
  ];
  return `fallback-${hash.toString(16)}-${buffer.length}-${sample.map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// Re-export types
export type { TokenCounts } from './tokenizer';
