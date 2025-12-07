import { describe, it, expect } from 'vitest';
import {
  UpdateVisibilitySchema,
  UpdateModerationSchema,
  BulkCardOperationSchema,
  UpdateReportStatusSchema,
  AdminVisibilityFilterSchema,
  AdminModerationFilterSchema,
  AdminCardsFilterSchema,
  AdminUsersFilterSchema,
  AdminReportsFilterSchema,
  ToggleAdminSchema,
} from '../admin';

describe('UpdateVisibilitySchema', () => {
  it('accepts valid visibility states', () => {
    const states = ['public', 'nsfw_only', 'unlisted', 'blocked'];
    for (const visibility of states) {
      const result = UpdateVisibilitySchema.safeParse({ visibility });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid visibility state', () => {
    expect(UpdateVisibilitySchema.safeParse({ visibility: 'private' }).success).toBe(false);
    expect(UpdateVisibilitySchema.safeParse({ visibility: 'hidden' }).success).toBe(false);
  });

  it('requires visibility field', () => {
    expect(UpdateVisibilitySchema.safeParse({}).success).toBe(false);
  });
});

describe('UpdateModerationSchema', () => {
  it('accepts valid moderation states', () => {
    const states = ['ok', 'review', 'blocked'];
    for (const state of states) {
      const result = UpdateModerationSchema.safeParse({ state });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid moderation state', () => {
    expect(UpdateModerationSchema.safeParse({ state: 'pending' }).success).toBe(false);
    expect(UpdateModerationSchema.safeParse({ state: 'approved' }).success).toBe(false);
  });

  it('requires state field', () => {
    expect(UpdateModerationSchema.safeParse({}).success).toBe(false);
  });
});

describe('BulkCardOperationSchema', () => {
  const validId = 'a'.repeat(21); // Valid nanoid length

  it('accepts valid bulk operation', () => {
    const result = BulkCardOperationSchema.safeParse({
      cardIds: [validId],
      action: 'delete',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid actions', () => {
    const actions = ['delete', 'block', 'unblock', 'make_public', 'make_unlisted'];
    for (const action of actions) {
      const result = BulkCardOperationSchema.safeParse({
        cardIds: [validId],
        action,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid action', () => {
    const result = BulkCardOperationSchema.safeParse({
      cardIds: [validId],
      action: 'approve',
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one card ID', () => {
    const result = BulkCardOperationSchema.safeParse({
      cardIds: [],
      action: 'delete',
    });
    expect(result.success).toBe(false);
  });

  it('limits to 100 card IDs', () => {
    const result = BulkCardOperationSchema.safeParse({
      cardIds: Array(101).fill(validId),
      action: 'delete',
    });
    expect(result.success).toBe(false);
  });

  it('accepts up to 100 card IDs', () => {
    const result = BulkCardOperationSchema.safeParse({
      cardIds: Array(100).fill(validId),
      action: 'delete',
    });
    expect(result.success).toBe(true);
  });

  it('validates card ID format', () => {
    const result = BulkCardOperationSchema.safeParse({
      cardIds: ['short'], // Too short for nanoid
      action: 'delete',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateReportStatusSchema', () => {
  it('accepts all valid status values', () => {
    const statuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
    for (const status of statuses) {
      const result = UpdateReportStatusSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(UpdateReportStatusSchema.safeParse({ status: 'approved' }).success).toBe(false);
  });

  it('accepts optional notes', () => {
    const result = UpdateReportStatusSchema.safeParse({
      status: 'resolved',
      notes: 'Action taken against the card',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('Action taken against the card');
    }
  });

  it('enforces max notes length', () => {
    const result = UpdateReportStatusSchema.safeParse({
      status: 'resolved',
      notes: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts notes at max length', () => {
    const result = UpdateReportStatusSchema.safeParse({
      status: 'resolved',
      notes: 'a'.repeat(1000),
    });
    expect(result.success).toBe(true);
  });
});

describe('AdminVisibilityFilterSchema', () => {
  it('accepts all visibility states including all', () => {
    const values = ['public', 'nsfw_only', 'unlisted', 'blocked', 'all'];
    for (const value of values) {
      const result = AdminVisibilityFilterSchema.safeParse(value);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid values', () => {
    expect(AdminVisibilityFilterSchema.safeParse('private').success).toBe(false);
  });
});

describe('AdminModerationFilterSchema', () => {
  it('accepts all moderation states including all', () => {
    const values = ['ok', 'review', 'blocked', 'all'];
    for (const value of values) {
      const result = AdminModerationFilterSchema.safeParse(value);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid values', () => {
    expect(AdminModerationFilterSchema.safeParse('pending').success).toBe(false);
  });
});

describe('AdminCardsFilterSchema', () => {
  it('provides defaults', () => {
    const result = AdminCardsFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(24);
      expect(result.data.search).toBe('');
      expect(result.data.sort).toBe('newest');
    }
  });

  it('accepts valid search query', () => {
    const result = AdminCardsFilterSchema.safeParse({ search: 'test' });
    expect(result.success).toBe(true);
  });

  it('enforces max search length', () => {
    const result = AdminCardsFilterSchema.safeParse({ search: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('accepts visibility filter', () => {
    const result = AdminCardsFilterSchema.safeParse({ visibility: 'blocked' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('blocked');
    }
  });

  it('accepts moderation filter', () => {
    const result = AdminCardsFilterSchema.safeParse({ moderation: 'review' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moderation).toBe('review');
    }
  });

  it('accepts valid admin sort options', () => {
    const sorts = ['newest', 'oldest', 'reports', 'downloads'];
    for (const sort of sorts) {
      const result = AdminCardsFilterSchema.safeParse({ sort });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid sort options', () => {
    expect(AdminCardsFilterSchema.safeParse({ sort: 'popular' }).success).toBe(false);
    expect(AdminCardsFilterSchema.safeParse({ sort: 'trending' }).success).toBe(false);
  });
});

describe('AdminUsersFilterSchema', () => {
  it('provides defaults', () => {
    const result = AdminUsersFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(24);
      expect(result.data.search).toBe('');
      expect(result.data.sort).toBe('newest');
    }
  });

  it('coerces isAdmin boolean', () => {
    const result = AdminUsersFilterSchema.safeParse({ isAdmin: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAdmin).toBe(true);
    }
  });

  it('accepts valid sort options', () => {
    const sorts = ['newest', 'oldest', 'username', 'cards'];
    for (const sort of sorts) {
      const result = AdminUsersFilterSchema.safeParse({ sort });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid sort options', () => {
    expect(AdminUsersFilterSchema.safeParse({ sort: 'downloads' }).success).toBe(false);
  });
});

describe('AdminReportsFilterSchema', () => {
  it('provides defaults', () => {
    const result = AdminReportsFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(24);
      expect(result.data.status).toBe('pending');
      expect(result.data.sort).toBe('newest');
    }
  });

  it('accepts all status values including all', () => {
    const statuses = ['pending', 'reviewed', 'resolved', 'dismissed', 'all'];
    for (const status of statuses) {
      const result = AdminReportsFilterSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('accepts valid sort options', () => {
    expect(AdminReportsFilterSchema.safeParse({ sort: 'newest' }).success).toBe(true);
    expect(AdminReportsFilterSchema.safeParse({ sort: 'oldest' }).success).toBe(true);
  });

  it('rejects invalid sort options', () => {
    expect(AdminReportsFilterSchema.safeParse({ sort: 'reports' }).success).toBe(false);
  });
});

describe('ToggleAdminSchema', () => {
  it('accepts boolean isAdmin', () => {
    expect(ToggleAdminSchema.safeParse({ isAdmin: true }).success).toBe(true);
    expect(ToggleAdminSchema.safeParse({ isAdmin: false }).success).toBe(true);
  });

  it('requires isAdmin field', () => {
    expect(ToggleAdminSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-boolean isAdmin', () => {
    expect(ToggleAdminSchema.safeParse({ isAdmin: 'true' }).success).toBe(false);
    expect(ToggleAdminSchema.safeParse({ isAdmin: 1 }).success).toBe(false);
  });
});
