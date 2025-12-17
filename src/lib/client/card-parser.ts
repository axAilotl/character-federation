/**
 * Client-side card parser using character-foundry packages
 */
import { parseCard, type ParseResult } from '@character-foundry/character-foundry/loader';
import { voxtaToCCv3 } from '@character-foundry/character-foundry/voxta';
import type { CCv3Data, CCv3CharacterBook } from '@character-foundry/character-foundry/schemas';
import { countCardTokens, type TokenCounts } from './tokenizer';
import { extractZipEntry, indexZip, type ZipEntry } from './zip';

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
  /** Voxta package.json (if present) */
  voxtaPackageJson?: unknown;
  /** Parsed characters for Voxta packages (used for collection uploads) */
  voxtaCharacters?: Array<{ id: string; card: ParsedCard; thumbnail?: Uint8Array }>;
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

function toParsedCardFromCcv3(raw: CCv3Data, sourceFormat: SourceFormat): ParsedCard {
  const data = raw.data;

  const tokens = countCardTokens(data);
  const metadata = extractCardMetadata(data);

  return {
    raw,
    // The loader normalizes all cards into CCv3 shape; container-origin spec is tracked separately.
    specVersion: 'v3',
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

function isImageExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'webp' || e === 'gif';
}

function getExtFromPath(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return '';
  return path.slice(lastDot + 1).toLowerCase();
}

function getBaseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function getNameWithoutExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function normalizeAssetName(path: string, fallbackIndex: number): string {
  const base = getNameWithoutExt(getBaseName(path));
  const safe = base.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return safe || `asset_${fallbackIndex}`;
}

function sampleZipAssets(
  zip: Uint8Array,
  entries: ZipEntry[],
  opts: {
    include: (entry: ZipEntry) => boolean;
    maxItems: number;
    maxTotalBytes: number;
  }
): ExtractedAsset[] {
  const selected = entries.filter(opts.include);

  // Stable order (avoid random central-dir ordering differences)
  selected.sort((a, b) => a.name.localeCompare(b.name));

  const extracted: ExtractedAsset[] = [];
  let totalBytes = 0;

  for (let i = 0; i < selected.length; i++) {
    if (extracted.length >= opts.maxItems) break;

    const entry = selected[i];
    if (totalBytes >= opts.maxTotalBytes) break;
    // Use central-directory uncompressed size to avoid inflating a file we won't keep.
    if (totalBytes + entry.uncompressedSize > opts.maxTotalBytes) break;

    const ext = getExtFromPath(entry.name);
    const name = normalizeAssetName(entry.name, i);
    const buffer = extractZipEntry(zip, entry);

    totalBytes += buffer.byteLength;

    extracted.push({
      name,
      type: isImageExt(ext) ? 'image' : 'asset',
      ext: ext || 'bin',
      buffer,
      path: entry.name,
    });
  }

  return extracted;
}

function parseCharxFromZip(zip: Uint8Array): ParseResultWithAssets {
  const entries = indexZip(zip);

  const cardEntry = entries.find((e) => e.name === 'card.json');
  if (!cardEntry) {
    throw new Error('CharX: Missing card.json');
  }

  const cardJson = extractZipEntry(zip, cardEntry);
  const raw = JSON.parse(new TextDecoder().decode(cardJson)) as CCv3Data;

  const card = toParsedCardFromCcv3(raw, 'charx');

  // Main image: first icon-like asset
  const iconEntry = entries.find(
    (e) => e.name.toLowerCase().startsWith('assets/icon/') && isImageExt(getExtFromPath(e.name))
  );
  const mainImage = iconEntry ? extractZipEntry(zip, iconEntry) : undefined;

  // Sample non-icon assets for preview
  const extractedAssets = sampleZipAssets(zip, entries, {
    include: (e) =>
      e.name.toLowerCase().startsWith('assets/') &&
      !e.name.toLowerCase().startsWith('assets/icon/') &&
      isImageExt(getExtFromPath(e.name)),
    maxItems: 100,
    maxTotalBytes: 100 * 1024 * 1024,
  });

  return {
    card,
    extractedAssets,
    mainImage,
  };
}

function parseVoxtaFromZip(zip: Uint8Array): ParseResultWithAssets {
  const entries = indexZip(zip);

  const pkgEntry = entries.find((e) => e.name === 'package.json');
  const voxtaPackageJson = pkgEntry ? JSON.parse(new TextDecoder().decode(extractZipEntry(zip, pkgEntry))) : undefined;

  const charEntries = entries.filter((e) => /^Characters\/[^/]+\/character\.json$/i.test(e.name));
  if (charEntries.length === 0) {
    throw new Error('Voxta: No Characters/*/character.json entries found');
  }

  const voxtaCharacters: Array<{ id: string; card: ParsedCard; thumbnail?: Uint8Array }> = [];

  for (const entry of charEntries) {
    const match = /^Characters\/([^/]+)\/character\.json$/i.exec(entry.name);
    if (!match) continue;
    const id = match[1];

    const jsonBytes = extractZipEntry(zip, entry);
    const voxtaChar = JSON.parse(new TextDecoder().decode(jsonBytes)) as unknown;
    const ccv3 = voxtaToCCv3(voxtaChar as never, []);

    const card = toParsedCardFromCcv3(ccv3 as unknown as CCv3Data, 'voxta');

    const thumbEntry = entries.find(
      (e) =>
        e.name.toLowerCase().startsWith(`characters/${id.toLowerCase()}/thumbnail.`) &&
        isImageExt(getExtFromPath(e.name))
    );
    const thumbnail = thumbEntry ? extractZipEntry(zip, thumbEntry) : undefined;

    voxtaCharacters.push({ id, card, thumbnail });
  }

  if (voxtaCharacters.length === 0) {
    throw new Error('Voxta: Failed to extract characters');
  }

  const isMultiCharPackage = voxtaCharacters.length >= 2;

  // Pick a thumbnail character for preview (ThumbnailResource.Id preferred)
  let thumbCharId: string | null = null;
  const pkg = voxtaPackageJson as { ThumbnailResource?: { Id?: string } | null; Name?: string | null } | undefined;
  if (pkg?.ThumbnailResource?.Id) {
    thumbCharId = pkg.ThumbnailResource.Id;
  }
  if (!thumbCharId) {
    thumbCharId = voxtaCharacters[0].id;
  }

  const previewChar = voxtaCharacters.find((c) => c.id === thumbCharId) || voxtaCharacters[0];
  const packageName = (pkg?.Name || `${voxtaCharacters.length} Characters`) as string;

  // Sample assets only for single-character packages
  const extractedAssets = !isMultiCharPackage
    ? sampleZipAssets(zip, entries, {
        include: (e) => {
          const onlyId = voxtaCharacters[0].id.toLowerCase();
          return (
            e.name.toLowerCase().startsWith(`characters/${onlyId}/assets/`) &&
            isImageExt(getExtFromPath(e.name))
          );
        },
        maxItems: 100,
        maxTotalBytes: 100 * 1024 * 1024,
      })
    : [];

  return {
    card: previewChar.card,
    extractedAssets,
    mainImage: previewChar.thumbnail,
    isMultiCharPackage,
    packageCharCount: voxtaCharacters.length,
    packageName,
    voxtaPackageJson,
    voxtaCharacters,
  };
}

/**
 * Parse a character card from any supported format (client-side)
 */
export function parseFromBuffer(buffer: Uint8Array): ParsedCard {
  const result = parseFromBufferWithAssets(buffer);
  return result.card;
}

/**
 * Parse a character card and extract all binary assets
 */
export function parseFromBufferWithAssets(buffer: Uint8Array, filename?: string): ParseResultWithAssets {
  const lower = (filename || '').toLowerCase();

  // Prefer extension-based routing for ZIP containers to avoid extracting thousands of assets.
  if (lower.endsWith('.charx')) {
    return parseCharxFromZip(buffer);
  }
  if (lower.endsWith('.voxpkg')) {
    return parseVoxtaFromZip(buffer);
  }

  // Fallback: use the loader for PNG/JSON and unknown containers.
  const result = parseCard(buffer, { extractAssets: true });

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
