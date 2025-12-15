/**
 * Admin validation schemas
 */

import { z } from 'zod';
import { VisibilitySchema, ModerationStateSchema, PaginationSchema, NanoIdSchema } from './common';

// Update card visibility
export const UpdateVisibilitySchema = z.object({
  visibility: VisibilitySchema,
});

export type UpdateVisibilityInput = z.infer<typeof UpdateVisibilitySchema>;

// Update moderation state
export const UpdateModerationSchema = z.object({
  state: ModerationStateSchema,
});

export type UpdateModerationInput = z.infer<typeof UpdateModerationSchema>;

// Bulk card operations
export const BulkCardOperationSchema = z.object({
  cardIds: z.array(NanoIdSchema).min(1, 'At least one card ID required').max(100, 'Too many cards'),
  action: z.enum(['delete', 'block', 'unblock', 'make_public', 'make_unlisted']),
});

export type BulkCardOperationInput = z.infer<typeof BulkCardOperationSchema>;

// Update report status
export const UpdateReportStatusSchema = z.object({
  status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']),
  notes: z.string().max(1000).optional(),
});

export type UpdateReportStatusInput = z.infer<typeof UpdateReportStatusSchema>;

// Admin cards filter - extends visibility/moderation with 'all' option
export const AdminVisibilityFilterSchema = z.enum([
  'public',
  'private',
  'nsfw_only',
  'unlisted',
  'blocked',
  'all',
]);

export const AdminModerationFilterSchema = z.enum([
  'ok',
  'review',
  'blocked',
  'all',
]);

export const AdminCardsFilterSchema = PaginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  visibility: AdminVisibilityFilterSchema.optional(),
  moderation: AdminModerationFilterSchema.optional(),
  sort: z.enum(['newest', 'oldest', 'reports', 'downloads']).default('newest'),
});

export type AdminCardsFilterInput = z.infer<typeof AdminCardsFilterSchema>;

// Admin users filter
export const AdminUsersFilterSchema = PaginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  isAdmin: z.coerce.boolean().optional(),
  sort: z.enum(['newest', 'oldest', 'username', 'cards']).default('newest'),
});

export type AdminUsersFilterInput = z.infer<typeof AdminUsersFilterSchema>;

// Admin reports filter
export const AdminReportsFilterSchema = PaginationSchema.extend({
  status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed', 'all']).default('pending'),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

export type AdminReportsFilterInput = z.infer<typeof AdminReportsFilterSchema>;

// Toggle admin status
export const ToggleAdminSchema = z.object({
  isAdmin: z.boolean(),
});

export type ToggleAdminInput = z.infer<typeof ToggleAdminSchema>;

// Storage cleanup - either specific keys or all orphans
export const StorageCleanupSchema = z.union([
  z.object({
    keys: z.array(z.string().min(1).max(500)).min(1).max(1000),
    all: z.literal(false).optional(),
  }),
  z.object({
    keys: z.undefined().optional(),
    all: z.literal(true),
  }),
]).refine(
  (data) => data.keys !== undefined || data.all === true,
  { message: 'Provide keys array or all: true' }
);

export type StorageCleanupInput = z.infer<typeof StorageCleanupSchema>;
