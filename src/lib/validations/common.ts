/**
 * Common validation schemas shared across domains
 */

import { z } from 'zod';

// Pagination
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

// Sort options for cards
export const CardSortSchema = z.enum([
  'newest',
  'oldest',
  'popular',
  'trending',
  'downloads',
  'favorites',
  'rating',
]).default('newest');

// Visibility states
export const VisibilitySchema = z.enum([
  'public',
  'nsfw_only',
  'unlisted',
  'blocked',
]);

export const UploadVisibilitySchema = z.enum([
  'public',
  'nsfw_only',
  'unlisted',
]);

// Moderation states
export const ModerationStateSchema = z.enum([
  'ok',
  'review',
  'blocked',
]);

// ID formats
export const SlugSchema = z.string()
  .min(1, 'Slug is required')
  .max(200, 'Slug too long')
  .regex(/^[a-z0-9-]+$/, 'Invalid slug format');

export const NanoIdSchema = z.string()
  .min(10, 'Invalid ID')
  .max(30, 'Invalid ID');

// Tag schema
export const TagSlugSchema = z.string()
  .min(1, 'Tag is required')
  .max(50, 'Tag too long')
  .transform(tag => tag.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

export const TagArraySchema = z.array(TagSlugSchema).max(50, 'Too many tags');

// Token range
export const TokenRangeSchema = z.object({
  minTokens: z.coerce.number().int().min(0).optional(),
  maxTokens: z.coerce.number().int().min(0).optional(),
}).refine(
  data => !data.minTokens || !data.maxTokens || data.minTokens <= data.maxTokens,
  { message: 'minTokens must be less than or equal to maxTokens' }
);

// Boolean from query string
export const QueryBooleanSchema = z.string()
  .transform(val => val === 'true' || val === '1')
  .or(z.boolean());

// Comma-separated string to array
export const CommaSeparatedSchema = z.string()
  .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
  .or(z.array(z.string()));

// Search query schema
export const SearchQuerySchema = z.object({
  q: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  nsfw: QueryBooleanSchema.optional(),
});
