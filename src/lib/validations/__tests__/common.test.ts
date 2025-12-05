import { describe, it, expect } from 'vitest';
import {
  PaginationSchema,
  CardSortSchema,
  VisibilitySchema,
  UploadVisibilitySchema,
  ModerationStateSchema,
  SlugSchema,
  NanoIdSchema,
  TagSlugSchema,
  TagArraySchema,
  QueryBooleanSchema,
  CommaSeparatedSchema,
  SearchQuerySchema,
} from '../common';

describe('PaginationSchema', () => {
  it('provides defaults for missing values', () => {
    const result = PaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(24);
    }
  });

  it('coerces string numbers', () => {
    const result = PaginationSchema.safeParse({ page: '5', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(5);
      expect(result.data.limit).toBe(50);
    }
  });

  it('enforces minimum page of 1', () => {
    const result = PaginationSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('enforces maximum limit of 100', () => {
    const result = PaginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts valid pagination', () => {
    const result = PaginationSchema.safeParse({ page: 10, limit: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(10);
      expect(result.data.limit).toBe(50);
    }
  });
});

describe('CardSortSchema', () => {
  it('defaults to newest', () => {
    const result = CardSortSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('newest');
    }
  });

  it('accepts all valid sort options', () => {
    const validOptions = ['newest', 'oldest', 'popular', 'trending', 'downloads', 'favorites', 'rating'];
    for (const option of validOptions) {
      const result = CardSortSchema.safeParse(option);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid sort option', () => {
    const result = CardSortSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });
});

describe('VisibilitySchema', () => {
  it('accepts all valid visibility states', () => {
    const validStates = ['public', 'nsfw_only', 'unlisted', 'blocked'];
    for (const state of validStates) {
      const result = VisibilitySchema.safeParse(state);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid visibility state', () => {
    expect(VisibilitySchema.safeParse('private').success).toBe(false);
    expect(VisibilitySchema.safeParse('hidden').success).toBe(false);
  });
});

describe('UploadVisibilitySchema', () => {
  it('accepts upload visibility options (excludes blocked)', () => {
    expect(UploadVisibilitySchema.safeParse('public').success).toBe(true);
    expect(UploadVisibilitySchema.safeParse('nsfw_only').success).toBe(true);
    expect(UploadVisibilitySchema.safeParse('unlisted').success).toBe(true);
  });

  it('rejects blocked (admin only)', () => {
    expect(UploadVisibilitySchema.safeParse('blocked').success).toBe(false);
  });
});

describe('ModerationStateSchema', () => {
  it('accepts all valid moderation states', () => {
    expect(ModerationStateSchema.safeParse('ok').success).toBe(true);
    expect(ModerationStateSchema.safeParse('review').success).toBe(true);
    expect(ModerationStateSchema.safeParse('blocked').success).toBe(true);
  });

  it('rejects invalid state', () => {
    expect(ModerationStateSchema.safeParse('pending').success).toBe(false);
  });
});

describe('SlugSchema', () => {
  it('accepts valid slugs', () => {
    expect(SlugSchema.safeParse('my-card').success).toBe(true);
    expect(SlugSchema.safeParse('card123').success).toBe(true);
    expect(SlugSchema.safeParse('a').success).toBe(true);
  });

  it('rejects empty slug', () => {
    const result = SlugSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects slugs with uppercase', () => {
    expect(SlugSchema.safeParse('My-Card').success).toBe(false);
  });

  it('rejects slugs with special characters', () => {
    expect(SlugSchema.safeParse('my_card').success).toBe(false);
    expect(SlugSchema.safeParse('my.card').success).toBe(false);
    expect(SlugSchema.safeParse('my card').success).toBe(false);
  });
});

describe('NanoIdSchema', () => {
  it('accepts valid nanoid lengths', () => {
    expect(NanoIdSchema.safeParse('a'.repeat(10)).success).toBe(true);
    expect(NanoIdSchema.safeParse('a'.repeat(21)).success).toBe(true);
    expect(NanoIdSchema.safeParse('a'.repeat(30)).success).toBe(true);
  });

  it('rejects IDs that are too short', () => {
    expect(NanoIdSchema.safeParse('a'.repeat(9)).success).toBe(false);
  });

  it('rejects IDs that are too long', () => {
    expect(NanoIdSchema.safeParse('a'.repeat(31)).success).toBe(false);
  });
});

describe('TagSlugSchema', () => {
  it('transforms tags to lowercase', () => {
    const result = TagSlugSchema.safeParse('MyTag');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('mytag');
    }
  });

  it('replaces invalid characters with hyphens', () => {
    const result = TagSlugSchema.safeParse('my tag');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('my-tag');
    }
  });

  it('collapses multiple hyphens', () => {
    const result = TagSlugSchema.safeParse('my---tag');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('my-tag');
    }
  });

  it('trims whitespace', () => {
    const result = TagSlugSchema.safeParse('  tag  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('tag');
    }
  });

  it('rejects empty tags', () => {
    expect(TagSlugSchema.safeParse('').success).toBe(false);
  });
});

describe('TagArraySchema', () => {
  it('accepts array of tags', () => {
    const result = TagArraySchema.safeParse(['tag1', 'tag2', 'tag3']);
    expect(result.success).toBe(true);
  });

  it('rejects too many tags', () => {
    const tags = Array(51).fill('tag');
    const result = TagArraySchema.safeParse(tags);
    expect(result.success).toBe(false);
  });

  it('accepts max 50 tags', () => {
    const tags = Array(50).fill('tag');
    const result = TagArraySchema.safeParse(tags);
    expect(result.success).toBe(true);
  });
});

describe('QueryBooleanSchema', () => {
  it('parses "true" string as true', () => {
    const result = QueryBooleanSchema.safeParse('true');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }
  });

  it('parses "1" string as true', () => {
    const result = QueryBooleanSchema.safeParse('1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }
  });

  it('parses "false" string as false', () => {
    const result = QueryBooleanSchema.safeParse('false');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(false);
    }
  });

  it('accepts boolean values directly', () => {
    expect(QueryBooleanSchema.safeParse(true).data).toBe(true);
    expect(QueryBooleanSchema.safeParse(false).data).toBe(false);
  });
});

describe('CommaSeparatedSchema', () => {
  it('splits comma-separated string into array', () => {
    const result = CommaSeparatedSchema.safeParse('a,b,c');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['a', 'b', 'c']);
    }
  });

  it('trims whitespace from items', () => {
    const result = CommaSeparatedSchema.safeParse('a , b , c');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['a', 'b', 'c']);
    }
  });

  it('filters out empty items', () => {
    const result = CommaSeparatedSchema.safeParse('a,,b,');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['a', 'b']);
    }
  });

  it('accepts array directly', () => {
    const result = CommaSeparatedSchema.safeParse(['a', 'b', 'c']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['a', 'b', 'c']);
    }
  });
});

describe('SearchQuerySchema', () => {
  it('provides defaults', () => {
    const result = SearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('');
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('coerces string numbers', () => {
    const result = SearchQuerySchema.safeParse({
      q: 'test',
      limit: '50',
      offset: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  it('enforces max query length', () => {
    const result = SearchQuerySchema.safeParse({
      q: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('enforces max limit', () => {
    const result = SearchQuerySchema.safeParse({
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it('parses nsfw boolean', () => {
    const result = SearchQuerySchema.safeParse({
      q: 'test',
      nsfw: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nsfw).toBe(true);
    }
  });
});
