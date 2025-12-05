import { describe, it, expect } from 'vitest';
import {
  VoteSchema,
  CommentSchema,
  ReportSchema,
  ReportReasons,
} from '../interactions';

describe('VoteSchema', () => {
  it('accepts upvote (1)', () => {
    const result = VoteSchema.safeParse({ vote: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vote).toBe(1);
    }
  });

  it('accepts downvote (-1)', () => {
    const result = VoteSchema.safeParse({ vote: -1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vote).toBe(-1);
    }
  });

  it('rejects invalid vote values', () => {
    expect(VoteSchema.safeParse({ vote: 0 }).success).toBe(false);
    expect(VoteSchema.safeParse({ vote: 2 }).success).toBe(false);
    expect(VoteSchema.safeParse({ vote: -2 }).success).toBe(false);
    expect(VoteSchema.safeParse({ vote: 'up' }).success).toBe(false);
  });

  it('requires vote field', () => {
    const result = VoteSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('provides correct error message for invalid vote', () => {
    const result = VoteSchema.safeParse({ vote: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('1 (upvote) or -1 (downvote)');
    }
  });
});

describe('CommentSchema', () => {
  it('accepts valid comment', () => {
    const result = CommentSchema.safeParse({
      content: 'This is a great card!',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('This is a great card!');
    }
  });

  it('trims whitespace from content', () => {
    const result = CommentSchema.safeParse({
      content: '  Hello world  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Hello world');
    }
  });

  it('accepts comment with optional parentId', () => {
    const result = CommentSchema.safeParse({
      content: 'This is a reply',
      parentId: 'comment123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentId).toBe('comment123');
    }
  });

  it('accepts null parentId', () => {
    const result = CommentSchema.safeParse({
      content: 'Root comment',
      parentId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentId).toBe(null);
    }
  });

  it('rejects empty content', () => {
    const result = CommentSchema.safeParse({
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects content that is only whitespace (after trim)', () => {
    const result = CommentSchema.safeParse({
      content: '   ',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('required');
    }
  });

  it('rejects content that is too long', () => {
    const result = CommentSchema.safeParse({
      content: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('10000');
    }
  });

  it('accepts content at max length', () => {
    const result = CommentSchema.safeParse({
      content: 'a'.repeat(10000),
    });
    expect(result.success).toBe(true);
  });
});

describe('ReportSchema', () => {
  it('accepts valid report with reason only', () => {
    const result = ReportSchema.safeParse({
      reason: 'spam',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('spam');
    }
  });

  it('accepts valid report with reason and details', () => {
    const result = ReportSchema.safeParse({
      reason: 'other',
      details: 'This card contains copyrighted content.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details).toBe('This card contains copyrighted content.');
    }
  });

  it('accepts all valid reasons', () => {
    for (const reason of ReportReasons) {
      const result = ReportSchema.safeParse({ reason });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid reason', () => {
    const result = ReportSchema.safeParse({
      reason: 'invalid_reason',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('must be one of');
    }
  });

  it('rejects missing reason', () => {
    const result = ReportSchema.safeParse({
      details: 'Some details',
    });
    expect(result.success).toBe(false);
  });

  it('rejects details that are too long', () => {
    const result = ReportSchema.safeParse({
      reason: 'spam',
      details: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('1000');
    }
  });

  it('accepts details at max length', () => {
    const result = ReportSchema.safeParse({
      reason: 'spam',
      details: 'a'.repeat(1000),
    });
    expect(result.success).toBe(true);
  });
});

describe('ReportReasons', () => {
  it('contains expected reasons', () => {
    expect(ReportReasons).toContain('spam');
    expect(ReportReasons).toContain('harassment');
    expect(ReportReasons).toContain('inappropriate_content');
    expect(ReportReasons).toContain('copyright');
    expect(ReportReasons).toContain('other');
  });

  it('has 5 reasons', () => {
    expect(ReportReasons.length).toBe(5);
  });
});
