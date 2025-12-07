'use client';

import { useEffect, useState, useCallback } from 'react';

interface AdminTag {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  usageCount: number;
  isBlocked: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

type FilterType = 'all' | 'blocked' | 'active';

export default function AdminTagsPage() {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  // New tag form
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagCategory, setNewTagCategory] = useState('');
  const [newTagBlocked, setNewTagBlocked] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit modal
  const [editingTag, setEditingTag] = useState<AdminTag | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTags = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });
      if (search) params.set('search', search);
      if (filter !== 'all') params.set('filter', filter);

      const res = await fetch(`/api/admin/tags?${params}`);
      if (!res.ok) throw new Error('Failed to fetch tags');

      const data = await res.json();
      setTags(data.items);
      setPagination(prev => ({
        ...prev,
        total: data.total,
        hasMore: data.hasMore,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, search, filter]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleToggleBlocked = async (tag: AdminTag) => {
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBlocked: !tag.isBlocked }),
      });
      if (!res.ok) throw new Error('Failed to update tag');
      fetchTags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (tag: AdminTag) => {
    if (!confirm(`Delete tag "${tag.name}"? This will remove it from ${tag.usageCount} cards.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete tag');
      fetchTags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTagName.trim(),
          category: newTagCategory.trim() || null,
          isBlocked: newTagBlocked,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create tag');
      }

      setNewTagName('');
      setNewTagCategory('');
      setNewTagBlocked(false);
      setShowNewTagForm(false);
      fetchTags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create tag');
    } finally {
      setCreating(false);
    }
  };

  const handleEditTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTag || !editName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tags/${editingTag.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          category: editCategory.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update tag');
      }

      setEditingTag(null);
      fetchTags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update tag');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (tag: AdminTag) => {
    setEditingTag(tag);
    setEditName(tag.name);
    setEditCategory(tag.category || '');
  };

  const categories = ['genre', 'pov', 'rating', 'theme', 'type', 'species', 'gender'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-starlight">Tag Management</h1>
          <p className="text-sm text-starlight/60 mt-1">
            Manage tags and block tags from being used in uploads
          </p>
        </div>
        <button
          onClick={() => setShowNewTagForm(!showNewTagForm)}
          className="px-4 py-2 bg-nebula hover:bg-nebula/80 text-white rounded-lg transition-colors"
        >
          {showNewTagForm ? 'Cancel' : 'Add Tag'}
        </button>
      </div>

      {/* New Tag Form */}
      {showNewTagForm && (
        <form onSubmit={handleCreateTag} className="bg-cosmic-teal/30 rounded-lg p-4 border border-nebula/20">
          <h3 className="text-lg font-semibold text-starlight mb-4">Create New Tag</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-starlight/70 mb-1">Tag Name</label>
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Enter tag name..."
                className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/50 focus:outline-none focus:border-nebula"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-starlight/70 mb-1">Category</label>
              <select
                value={newTagCategory}
                onChange={(e) => setNewTagCategory(e.target.value)}
                className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight focus:outline-none focus:border-nebula"
              >
                <option value="">No category</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTagBlocked}
                  onChange={(e) => setNewTagBlocked(e.target.checked)}
                  className="rounded border-nebula/30"
                />
                <span className="text-sm text-starlight/70">Block from uploads</span>
              </label>
              <button
                type="submit"
                disabled={creating || !newTagName.trim()}
                className="px-4 py-2 bg-nebula hover:bg-nebula/80 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="bg-cosmic-teal/30 rounded-lg p-4 border border-nebula/20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-starlight/70 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags..."
              className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/50 focus:outline-none focus:border-nebula"
            />
          </div>
          <div>
            <label className="block text-sm text-starlight/70 mb-1">Status</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight focus:outline-none focus:border-nebula"
            >
              <option value="all">All Tags</option>
              <option value="blocked">Blocked Only</option>
              <option value="active">Active Only</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
              className="px-4 py-2 bg-nebula/20 hover:bg-nebula/30 text-starlight rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Blocked Tags Summary */}
      {tags.filter(t => t.isBlocked).length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <h3 className="text-red-400 font-semibold mb-2">Blocked Tags</h3>
          <p className="text-sm text-starlight/70 mb-3">
            Cards with these tags will be rejected during upload:
          </p>
          <div className="flex flex-wrap gap-2">
            {tags.filter(t => t.isBlocked).map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400 text-sm"
              >
                {tag.name}
                <button
                  onClick={() => handleToggleBlocked(tag)}
                  className="hover:text-red-300 transition-colors"
                  title="Unblock tag"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tags Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-nebula"></div>
        </div>
      ) : error ? (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
          <p className="text-red-400">Error: {error}</p>
        </div>
      ) : (
        <>
          <div className="bg-cosmic-teal/30 rounded-lg border border-nebula/20 overflow-hidden">
            <table className="w-full">
              <thead className="bg-deep-space/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Tag</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Slug</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Category</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Usage</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Status</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-starlight/70">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-nebula/10">
                {tags.map((tag) => (
                  <tr key={tag.id} className="hover:bg-nebula/5 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-starlight font-medium">{tag.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-sm text-starlight/60 bg-deep-space px-2 py-0.5 rounded">
                        {tag.slug}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {tag.category ? (
                        <span className="px-2 py-1 bg-nebula/20 text-nebula text-xs rounded-full">
                          {tag.category}
                        </span>
                      ) : (
                        <span className="text-starlight/30 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-starlight/70">
                      {tag.usageCount} cards
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleBlocked(tag)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          tag.isBlocked
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                        }`}
                      >
                        {tag.isBlocked ? 'Blocked' : 'Active'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(tag)}
                          className="p-1.5 hover:bg-nebula/20 rounded transition-colors text-starlight/70 hover:text-starlight"
                          title="Edit Tag"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(tag)}
                          className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-red-400"
                          title="Delete Tag"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-starlight/70">
              Showing {tags.length} of {pagination.total} tags
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-4 py-2 bg-nebula/20 hover:bg-nebula/30 disabled:opacity-50 disabled:cursor-not-allowed text-starlight rounded-lg transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                disabled={!pagination.hasMore}
                className="px-4 py-2 bg-nebula/20 hover:bg-nebula/30 disabled:opacity-50 disabled:cursor-not-allowed text-starlight rounded-lg transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingTag && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-cosmic-teal rounded-xl p-6 w-full max-w-md border border-nebula/30">
            <h2 className="text-xl font-bold text-starlight mb-4">Edit Tag</h2>
            <form onSubmit={handleEditTag} className="space-y-4">
              <div>
                <label className="block text-sm text-starlight/70 mb-1">Tag Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight focus:outline-none focus:border-nebula"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-starlight/70 mb-1">Category</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight focus:outline-none focus:border-nebula"
                >
                  <option value="">No category</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setEditingTag(null)}
                  className="px-4 py-2 bg-nebula/20 hover:bg-nebula/30 text-starlight rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !editName.trim()}
                  className="px-4 py-2 bg-nebula hover:bg-nebula/80 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
