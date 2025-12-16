/**
 * Card validation schemas
 */

import { z } from 'zod';
import {
  PaginationSchema,
  CardSortSchema,
  UploadVisibilitySchema,
  CommaSeparatedSchema,
  QueryBooleanSchema,
} from './common';

// Card filters for GET /api/cards
export const CardFiltersSchema = PaginationSchema.extend({
  search: z.string().max(200).optional(),
  tags: CommaSeparatedSchema.optional(),
  excludeTags: CommaSeparatedSchema.optional(),
  sort: CardSortSchema.optional(),
  minTokens: z.coerce.number().int().min(0).optional(),
  maxTokens: z.coerce.number().int().min(0).optional(),
  hasAltGreetings: QueryBooleanSchema.optional(),
  hasLorebook: QueryBooleanSchema.optional(),
  hasEmbeddedImages: QueryBooleanSchema.optional(),
  includeNsfw: QueryBooleanSchema.optional(),
});

export type CardFiltersInput = z.infer<typeof CardFiltersSchema>;

// Card upload metadata (client-side parsed)
export const CardUploadMetadataSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().max(10000, 'Description too long').optional().default(''),
  creator: z.string().max(200, 'Creator name too long').optional().default(''),
  creatorNotes: z.string().max(50000, 'Creator notes too long').optional().default(''),
  specVersion: z.enum(['v2', 'v3']),
  sourceFormat: z.enum(['png', 'json', 'charx', 'voxta']),
  tokens: z.object({
    description: z.number().int().min(0),
    personality: z.number().int().min(0),
    scenario: z.number().int().min(0),
    mesExample: z.number().int().min(0),
    firstMes: z.number().int().min(0),
    systemPrompt: z.number().int().min(0),
    postHistory: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  metadata: z.object({
    hasAlternateGreetings: z.boolean(),
    alternateGreetingsCount: z.number().int().min(0),
    hasLorebook: z.boolean(),
    lorebookEntriesCount: z.number().int().min(0),
    hasEmbeddedImages: z.boolean(),
    embeddedImagesCount: z.number().int().min(0),
  }),
  tags: z.array(z.string()).max(50, 'Too many tags'),
  contentHash: z.string().length(64, 'Invalid content hash'),
  cardData: z.string().min(1, 'Card data is required'),
});

export type CardUploadMetadata = z.infer<typeof CardUploadMetadataSchema>;

// Card upload form data validation
export const CardUploadFormSchema = z.object({
  visibility: UploadVisibilitySchema.default('public'),
  tags: z.string().optional().transform(val => {
    if (!val) return [];
    try {
      return JSON.parse(val) as string[];
    } catch {
      return [];
    }
  }),
  metadata: z.string().optional().transform(val => {
    if (!val) return null;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }),
});

// Supported file extensions
export const SUPPORTED_EXTENSIONS = ['.png', '.json', '.charx', '.voxpkg'] as const;
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const CardFileSchema = z.object({
  name: z.string().refine(
    name => SUPPORTED_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext)),
    { message: `File must be one of: ${SUPPORTED_EXTENSIONS.join(', ')}` }
  ),
  size: z.number().max(MAX_FILE_SIZE, `File must be less than 50MB`),
});
