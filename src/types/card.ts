// Character Card Types following CCv2/v3 spec

// CCv2 Spec: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
export interface CharacterCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;

    // Optional fields
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];

    // Tags
    tags?: string[];

    // Creator info
    creator?: string;
    character_version?: string;

    // Character book (lorebook)
    character_book?: CharacterBook;

    // Extensions
    extensions?: Record<string, unknown>;
  };
}

// CCv3 Spec: https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md
export interface CharacterCardV3 {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;

    // Optional fields
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];

    // Tags
    tags?: string[];

    // Creator info
    creator?: string;
    character_version?: string;

    // Character book (lorebook)
    character_book?: CharacterBook;

    // V3 specific - Assets
    assets?: CharacterAsset[];

    // V3 specific - Group greetings
    group_only_greetings?: string[];

    // Extensions
    extensions?: Record<string, unknown>;
  };
}

// Character book (lorebook) structure
export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions?: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;

  // Optional fields
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: 'before_char' | 'after_char';
}

// V3 Assets
export interface CharacterAsset {
  type: 'icon' | 'background' | 'user_icon' | 'system_icon';
  uri: string;
  name?: string;
  ext?: string;
}

// Union type for any character card
export type CharacterCard = CharacterCardV2 | CharacterCardV3;

// Source format type
export type SourceFormat = 'png' | 'json' | 'charx' | 'voxta';

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
export type CardVisibility = 'public' | 'nsfw_only' | 'unlisted' | 'blocked';

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
