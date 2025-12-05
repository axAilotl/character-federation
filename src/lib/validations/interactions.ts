/**
 * Card interaction validation schemas (vote, comment, report, favorite)
 */

import { z } from 'zod';

// Vote request
export const VoteSchema = z.object({
  vote: z.union([z.literal(1), z.literal(-1)], {
    errorMap: () => ({ message: 'Vote must be 1 (upvote) or -1 (downvote)' }),
  }),
});

export type VoteInput = z.infer<typeof VoteSchema>;

// Comment request
export const CommentSchema = z.object({
  content: z.string()
    .max(10000, 'Comment is too long (max 10000 characters)')
    .transform(val => val.trim())
    .refine(val => val.length >= 1, { message: 'Comment content is required' }),
  parentId: z.string().max(30).optional().nullable(),
});

export type CommentInput = z.infer<typeof CommentSchema>;

// Report reasons
export const ReportReasons = [
  'spam',
  'harassment',
  'inappropriate_content',
  'copyright',
  'other',
] as const;

export const ReportReasonSchema = z.enum(ReportReasons, {
  errorMap: () => ({ message: `Reason must be one of: ${ReportReasons.join(', ')}` }),
});

// Report request
export const ReportSchema = z.object({
  reason: ReportReasonSchema,
  details: z.string().max(1000, 'Details too long (max 1000 characters)').optional(),
});

export type ReportInput = z.infer<typeof ReportSchema>;
