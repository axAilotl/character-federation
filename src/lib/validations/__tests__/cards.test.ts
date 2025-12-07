import { describe, it, expect } from 'vitest';
import {
  CardFiltersSchema,
  CardUploadMetadataSchema,
  CardUploadFormSchema,
  CardFileSchema,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from '../cards';

describe('CardFiltersSchema', () => {
  it('provides pagination defaults', () => {
    const result = CardFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(24);
    }
  });

  it('accepts valid search query', () => {
    const result = CardFiltersSchema.safeParse({ search: 'test query' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe('test query');
    }
  });

  it('rejects search query over 200 chars', () => {
    const result = CardFiltersSchema.safeParse({ search: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('parses comma-separated tags', () => {
    const result = CardFiltersSchema.safeParse({ tags: 'tag1,tag2,tag3' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['tag1', 'tag2', 'tag3']);
    }
  });

  it('parses comma-separated excludeTags', () => {
    const result = CardFiltersSchema.safeParse({ excludeTags: 'nsfw,gore' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.excludeTags).toEqual(['nsfw', 'gore']);
    }
  });

  it('coerces token range to numbers', () => {
    const result = CardFiltersSchema.safeParse({
      minTokens: '100',
      maxTokens: '5000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minTokens).toBe(100);
      expect(result.data.maxTokens).toBe(5000);
    }
  });

  it('rejects negative token values', () => {
    expect(CardFiltersSchema.safeParse({ minTokens: -1 }).success).toBe(false);
    expect(CardFiltersSchema.safeParse({ maxTokens: -1 }).success).toBe(false);
  });

  it('parses boolean filter flags', () => {
    const result = CardFiltersSchema.safeParse({
      hasAltGreetings: 'true',
      hasLorebook: '1',
      hasEmbeddedImages: 'false',
      includeNsfw: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasAltGreetings).toBe(true);
      expect(result.data.hasLorebook).toBe(true);
      expect(result.data.hasEmbeddedImages).toBe(false);
      expect(result.data.includeNsfw).toBe(true);
    }
  });

  it('accepts valid sort options', () => {
    const sortOptions = ['newest', 'oldest', 'popular', 'trending', 'downloads', 'favorites', 'rating'];
    for (const sort of sortOptions) {
      const result = CardFiltersSchema.safeParse({ sort });
      expect(result.success).toBe(true);
    }
  });
});

describe('CardUploadMetadataSchema', () => {
  const validMetadata = {
    name: 'Test Card',
    description: 'A test character',
    creator: 'Test Creator',
    creatorNotes: 'Some notes',
    specVersion: 'v3' as const,
    sourceFormat: 'png' as const,
    tokens: {
      description: 100,
      personality: 50,
      scenario: 25,
      mesExample: 200,
      firstMes: 150,
      systemPrompt: 75,
      postHistory: 30,
      total: 630,
    },
    metadata: {
      hasAlternateGreetings: true,
      alternateGreetingsCount: 3,
      hasLorebook: false,
      lorebookEntriesCount: 0,
      hasEmbeddedImages: true,
      embeddedImagesCount: 5,
    },
    tags: ['fantasy', 'adventure'],
    contentHash: 'a'.repeat(64),
    cardData: '{"spec":"chara_card_v3","data":{}}',
  };

  it('accepts valid metadata', () => {
    const result = CardUploadMetadataSchema.safeParse(validMetadata);
    expect(result.success).toBe(true);
  });

  it('requires name', () => {
    const { name, ...rest } = validMetadata;
    expect(CardUploadMetadataSchema.safeParse(rest).success).toBe(false);
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, name: '' }).success).toBe(false);
  });

  it('enforces name max length', () => {
    const result = CardUploadMetadataSchema.safeParse({
      ...validMetadata,
      name: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('enforces description max length', () => {
    const result = CardUploadMetadataSchema.safeParse({
      ...validMetadata,
      description: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('enforces creatorNotes max length', () => {
    const result = CardUploadMetadataSchema.safeParse({
      ...validMetadata,
      creatorNotes: 'a'.repeat(50001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid spec versions', () => {
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, specVersion: 'v2' }).success).toBe(true);
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, specVersion: 'v3' }).success).toBe(true);
  });

  it('rejects invalid spec version', () => {
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, specVersion: 'v1' }).success).toBe(false);
  });

  it('accepts valid source formats', () => {
    const formats = ['png', 'json', 'charx', 'voxta'] as const;
    for (const format of formats) {
      const result = CardUploadMetadataSchema.safeParse({ ...validMetadata, sourceFormat: format });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid source format', () => {
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, sourceFormat: 'txt' }).success).toBe(false);
  });

  it('requires valid content hash (64 chars)', () => {
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, contentHash: 'short' }).success).toBe(false);
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, contentHash: 'a'.repeat(65) }).success).toBe(false);
    expect(CardUploadMetadataSchema.safeParse({ ...validMetadata, contentHash: 'a'.repeat(64) }).success).toBe(true);
  });

  it('enforces max 50 tags', () => {
    const result = CardUploadMetadataSchema.safeParse({
      ...validMetadata,
      tags: Array(51).fill('tag'),
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative token counts', () => {
    const result = CardUploadMetadataSchema.safeParse({
      ...validMetadata,
      tokens: { ...validMetadata.tokens, description: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('provides defaults for optional fields', () => {
    const minimal = {
      name: 'Test',
      specVersion: 'v3' as const,
      sourceFormat: 'png' as const,
      tokens: validMetadata.tokens,
      metadata: validMetadata.metadata,
      tags: [],
      contentHash: 'a'.repeat(64),
      cardData: '{}',
    };
    const result = CardUploadMetadataSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('');
      expect(result.data.creator).toBe('');
      expect(result.data.creatorNotes).toBe('');
    }
  });
});

describe('CardUploadFormSchema', () => {
  it('defaults visibility to public', () => {
    const result = CardUploadFormSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('public');
    }
  });

  it('accepts valid visibility values', () => {
    const visibilities = ['public', 'nsfw_only', 'unlisted'];
    for (const visibility of visibilities) {
      const result = CardUploadFormSchema.safeParse({ visibility });
      expect(result.success).toBe(true);
    }
  });

  it('rejects blocked visibility (admin only)', () => {
    const result = CardUploadFormSchema.safeParse({ visibility: 'blocked' });
    expect(result.success).toBe(false);
  });

  it('parses JSON tags string to array', () => {
    const result = CardUploadFormSchema.safeParse({
      tags: '["fantasy", "adventure"]',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['fantasy', 'adventure']);
    }
  });

  it('returns empty array for invalid tags JSON', () => {
    const result = CardUploadFormSchema.safeParse({
      tags: 'not valid json',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it('parses JSON metadata string', () => {
    const metadata = { name: 'Test' };
    const result = CardUploadFormSchema.safeParse({
      metadata: JSON.stringify(metadata),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual(metadata);
    }
  });

  it('returns null for invalid metadata JSON', () => {
    const result = CardUploadFormSchema.safeParse({
      metadata: 'not valid json',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toBeNull();
    }
  });
});

describe('CardFileSchema', () => {
  it('accepts PNG files', () => {
    const result = CardFileSchema.safeParse({ name: 'character.png', size: 1024 });
    expect(result.success).toBe(true);
  });

  it('accepts JSON files', () => {
    const result = CardFileSchema.safeParse({ name: 'character.json', size: 1024 });
    expect(result.success).toBe(true);
  });

  it('accepts CharX files', () => {
    const result = CardFileSchema.safeParse({ name: 'character.charx', size: 1024 });
    expect(result.success).toBe(true);
  });

  it('accepts Voxta files', () => {
    const result = CardFileSchema.safeParse({ name: 'character.voxpkg', size: 1024 });
    expect(result.success).toBe(true);
  });

  it('is case insensitive for extensions', () => {
    expect(CardFileSchema.safeParse({ name: 'CHARACTER.PNG', size: 1024 }).success).toBe(true);
    expect(CardFileSchema.safeParse({ name: 'card.CHARX', size: 1024 }).success).toBe(true);
  });

  it('rejects unsupported file types', () => {
    expect(CardFileSchema.safeParse({ name: 'file.txt', size: 1024 }).success).toBe(false);
    expect(CardFileSchema.safeParse({ name: 'file.jpg', size: 1024 }).success).toBe(false);
    expect(CardFileSchema.safeParse({ name: 'file.webp', size: 1024 }).success).toBe(false);
    expect(CardFileSchema.safeParse({ name: 'file.zip', size: 1024 }).success).toBe(false);
  });

  it('rejects files over 50MB', () => {
    const result = CardFileSchema.safeParse({
      name: 'large.png',
      size: MAX_FILE_SIZE + 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts files at exactly 50MB', () => {
    const result = CardFileSchema.safeParse({
      name: 'exact.png',
      size: MAX_FILE_SIZE,
    });
    expect(result.success).toBe(true);
  });
});

describe('Constants', () => {
  it('has correct supported extensions', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('.png');
    expect(SUPPORTED_EXTENSIONS).toContain('.json');
    expect(SUPPORTED_EXTENSIONS).toContain('.charx');
    expect(SUPPORTED_EXTENSIONS).toContain('.voxpkg');
    expect(SUPPORTED_EXTENSIONS.length).toBe(4);
  });

  it('has correct max file size (50MB)', () => {
    expect(MAX_FILE_SIZE).toBe(50 * 1024 * 1024);
  });
});
