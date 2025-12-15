// Character Card Types - Re-exported from @character-foundry/schemas
// CCv2 Spec: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
// CCv3 Spec: https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md

// Re-export canonical types from @character-foundry/schemas
export type {
  CCv2Wrapped,
  CCv2Data,
  CCv3Data,
  CCv3DataInner,
  CCv2CharacterBook,
  CCv3CharacterBook,
  CCv2LorebookEntry,
  CCv3LorebookEntry,
  AssetDescriptor,
  SourceFormat as SchemaSourceFormat, // Renamed - schemas has granular format (png_v2, json_v3, etc.)
  DerivedFeatures,
  NormalizedCard,
} from '@character-foundry/schemas';

// Re-export Zod schemas for validation
export {
  CCv2WrappedSchema,
  CCv2DataSchema,
  CCv3DataSchema,
  CCv3DataInnerSchema,
  CCv2CharacterBookSchema,
  CCv3CharacterBookSchema,
  CCv2LorebookEntrySchema,
  CCv3LorebookEntrySchema,
  AssetDescriptorSchema,
  SourceFormatSchema as SchemaSourceFormatSchema, // Renamed - granular format schema
} from '@character-foundry/schemas';

// Re-export utility functions
export {
  detectSpec,
  detectSpecDetailed,
  hasLorebook,
  looksLikeCard,
  CardNormalizer,
  safeParse,
  zodErrorToMessage,
  createEmptyFeatures,
  createEmptyNormalizedCard,
} from '@character-foundry/schemas';

// Legacy type aliases for backward compatibility
import type {
  CCv2Wrapped,
  CCv3Data,
  CCv3CharacterBook,
  CCv3LorebookEntry,
  AssetDescriptor,
} from '@character-foundry/schemas';

// Local SourceFormat (simplified - schemas package has granular png_v2/png_v3/json_v2/json_v3)
export type SourceFormat = 'png' | 'json' | 'charx' | 'voxta';

/** @deprecated Use CCv2Wrapped from @character-foundry/schemas */
export type CharacterCardV2 = CCv2Wrapped;

/** @deprecated Use CCv3Data from @character-foundry/schemas */
export type CharacterCardV3 = CCv3Data;

/** @deprecated Use CCv3CharacterBook from @character-foundry/schemas */
export type CharacterBook = CCv3CharacterBook;

/** @deprecated Use CCv3LorebookEntry from @character-foundry/schemas */
export type CharacterBookEntry = CCv3LorebookEntry;

/** @deprecated Use AssetDescriptor from @character-foundry/schemas */
export type CharacterAsset = AssetDescriptor;

// Union type for any character card
export type CharacterCard = CCv2Wrapped | CCv3Data;

// Common extension types
export interface ChubExtensions {
  id?: string;
  full_path?: string;
  custom_css?: string;
  [key: string]: unknown;
}

export interface WyvernExtensions {
  depth_prompt?: {
    prompt: string;
    depth: number;
  };
  visual_description?: string;
  [key: string]: unknown;
}

// Parsed card with metadata
export interface ParsedCard {
  raw: CharacterCard;
  specVersion: 'v2' | 'v3';
  sourceFormat: SourceFormat;

  // Extracted fields for easy access
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

  // Token counts
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

  // Metadata
  metadata: {
    hasAlternateGreetings: boolean;
    alternateGreetingsCount: number;
    hasLorebook: boolean;
    lorebookEntriesCount: number;
    hasEmbeddedImages: boolean;
    embeddedImagesCount: number;
  };

  // Lorebook if present
  lorebook?: CharacterBook;

  // V3 assets if present
  assets?: CharacterAsset[];
}

// Visibility states for cards
export type CardVisibility = 'public' | 'private' | 'nsfw_only' | 'unlisted' | 'blocked';

// Moderation states
export type ModerationState = 'ok' | 'review' | 'blocked';

// API Response types
export interface CardListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator: string | null;
  creatorNotes: string | null;
  specVersion: string;
  sourceFormat: SourceFormat;
  hasAssets: boolean;
  assetsCount: number;
  imagePath: string | null;
  thumbnailPath: string | null;
  tokensTotal: number;

  // Stats
  upvotes: number;
  downvotes: number;
  /** Score = upvotes - downvotes, calculated once in data layer */
  score: number;
  favoritesCount: number;
  downloadsCount: number;
  commentsCount: number;
  forksCount: number;

  // Visibility
  visibility: CardVisibility;

  // Processing status (for large file uploads)
  processingStatus?: 'complete' | 'pending' | 'processing' | 'failed';

  // Metadata
  hasAlternateGreetings: boolean;
  alternateGreetingsCount: number;
  /** Total greetings = first_mes (1) + alternate_greetings */
  totalGreetingsCount: number;
  hasLorebook: boolean;
  lorebookEntriesCount: number;
  hasEmbeddedImages: boolean;
  embeddedImagesCount: number;

  // Tags
  tags: { id: number; name: string; slug: string; category: string | null }[];

  // Uploader
  uploader: { id: string; username: string; displayName: string | null } | null;

  // Timestamps
  createdAt: number;
  updatedAt: number;

  // User-specific (when authenticated)
  userVote?: number | null;
  isFavorited?: boolean;

  // Feed-specific (optional, used by /api/feed)
  feedReason?: 'followed_user' | 'followed_tag' | 'trending';

  // v1.2: Collection membership
  collectionId?: string | null;
  collectionSlug?: string | null;
  collectionName?: string | null;
}

// Saved asset from extracted packages (charx/voxta)
export interface SavedAssetInfo {
  name: string;
  type: string;
  ext: string;
  path: string;
  thumbnailPath?: string;
}

export interface CardDetail extends CardListItem {
  // Full token breakdown
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

  // Full card data
  cardData: CharacterCard;

  // Saved assets from extracted packages
  savedAssets: SavedAssetInfo[] | null;

  // Fork info (now includes version info)
  forkedFrom: { id: string; slug: string; name: string; versionId?: string } | null;

  // Image dimensions
  imageWidth: number | null;
  imageHeight: number | null;

  // Version info (new in v2 schema)
  versionId: string;
  storageUrl: string;
  contentHash: string;
}

// Filter/Sort options
export type SortOption = 'newest' | 'oldest' | 'popular' | 'trending' | 'downloads' | 'favorites' | 'rating';

export interface CardFilters {
  search?: string;
  tags?: string[];
  excludeTags?: string[];
  sort?: SortOption;
  page?: number;
  limit?: number;
  minTokens?: number;
  maxTokens?: number;
  hasAltGreetings?: boolean;
  hasLorebook?: boolean;
  hasEmbeddedImages?: boolean;
  // New visibility filters
  visibility?: CardVisibility[];
  includeNsfw?: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
