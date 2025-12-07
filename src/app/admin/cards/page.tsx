'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface AdminCard {
  id: string;
  slug: string;
  name: string;
  creator: string | null;
  visibility: 'public' | 'nsfw_only' | 'unlisted' | 'blocked';
  moderationState: 'ok' | 'review' | 'blocked';
  thumbnailPath: string | null;
  upvotes: number;
  downvotes: number;
  downloadsCount: number;
  reportsCount: number;
  createdAt: number;
  uploader: {
    id: string;
    username: string;
  } | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

type FilterVisibility = 'all' | 'public' | 'nsfw_only' | 'unlisted' | 'blocked';
type FilterModeration = 'all' | 'ok' | 'review' | 'blocked';

export default function AdminCardsPage() {
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<FilterVisibility>('all');
  const [moderation, setModeration] = useState<FilterModeration>('all');

  // Selected cards for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchCards = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });
      if (search) params.set('search', search);
      if (visibility !== 'all') params.set('visibility', visibility);
      if (moderation !== 'all') params.set('moderation', moderation);

      const res = await fetch(`/api/admin/cards?${params}`);
      if (!res.ok) throw new Error('Failed to fetch cards');

      const data = await res.json();
      setCards(data.items);
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
  }, [pagination.page, pagination.limit, search, visibility, moderation]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const handleVisibilityChange = async (cardId: string, newVisibility: string) => {
    try {
      const res = await fetch(`/api/admin/cards/${cardId}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      if (!res.ok) throw new Error('Failed to update visibility');
      fetchCards();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleModerationChange = async (cardId: string, newState: string) => {
    try {
      const res = await fetch(`/api/admin/cards/${cardId}/moderation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });
      if (!res.ok) throw new Error('Failed to update moderation state');
      fetchCards();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (cardId: string, cardName: string) => {
    if (!confirm(`Are you sure you want to delete "${cardName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/cards/${cardId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete card');
      fetchCards();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleBulkVisibility = async (newVisibility: string) => {
    if (selected.size === 0) return;
    if (!confirm(`Update visibility to "${newVisibility}" for ${selected.size} cards?`)) return;

    try {
      const res = await fetch('/api/admin/cards/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardIds: Array.from(selected),
          visibility: newVisibility,
        }),
      });
      if (!res.ok) throw new Error('Failed to update cards');
      setSelected(new Set());
      fetchCards();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`⚠️ DELETE ${selected.size} cards? This CANNOT be undone!`)) return;
    if (!confirm(`Are you ABSOLUTELY sure? Type count to confirm: ${selected.size} cards will be permanently deleted.`)) return;

    try {
      const res = await fetch('/api/admin/cards/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardIds: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error('Failed to delete cards');
      setSelected(new Set());
      fetchCards();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const toggleSelect = (cardId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === cards.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(cards.map(c => c.id)));
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-starlight">Cards Management</h1>
      </div>

      {/* Filters */}
      <div className="bg-cosmic-teal/30 rounded-lg p-4 border border-nebula/20">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-starlight/70 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards..."
              className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/50 focus:outline-none focus:border-nebula"
            />
          </div>
          <div>
            <label className="block text-sm text-starlight/70 mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as FilterVisibility)}
              className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight focus:outline-none focus:border-nebula"
            >
              <option value="all">All</option>
              <option value="public">Public</option>
              <option value="nsfw_only">NSFW Only</option>
              <option value="unlisted">Unlisted</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-starlight/70 mb-1">Moderation</label>
            <select
              value={moderation}
              onChange={(e) => setModeration(e.target.value as FilterModeration)}
              className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight focus:outline-none focus:border-nebula"
            >
              <option value="all">All</option>
              <option value="ok">OK</option>
              <option value="review">Needs Review</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearch('');
                setVisibility('all');
                setModeration('all');
              }}
              className="px-4 py-2 bg-nebula/20 hover:bg-nebula/30 text-starlight rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="bg-nebula/20 rounded-lg p-4 border border-nebula/30 flex items-center gap-4">
          <span className="text-starlight">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => handleBulkVisibility('public')}
              className="px-3 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded text-sm transition-colors"
            >
              Make Public
            </button>
            <button
              onClick={() => handleBulkVisibility('unlisted')}
              className="px-3 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded text-sm transition-colors"
            >
              Make Unlisted
            </button>
            <button
              onClick={() => handleBulkVisibility('blocked')}
              className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors"
            >
              Block
            </button>
            <span className="text-starlight/30">|</span>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded text-sm transition-colors font-bold border border-red-500/50"
            >
              DELETE SELECTED
            </button>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-starlight/70 hover:text-starlight transition-colors"
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Cards Table */}
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
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === cards.length && cards.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-nebula/30"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Card</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Visibility</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Moderation</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Stats</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Reports</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-starlight/70">Created</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-starlight/70">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-nebula/10">
                {cards.map((card) => (
                  <tr key={card.id} className="hover:bg-nebula/5 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(card.id)}
                        onChange={() => toggleSelect(card.id)}
                        className="rounded border-nebula/30"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-deep-space rounded overflow-hidden flex-shrink-0">
                          {card.thumbnailPath ? (
                            <Image
                              src={card.thumbnailPath.startsWith('/') ? card.thumbnailPath : `/api/uploads/${card.thumbnailPath}`}
                              alt={card.name}
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-starlight/30">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div>
                          <Link
                            href={`/card/${card.slug}`}
                            className="text-starlight hover:text-nebula transition-colors font-medium"
                            target="_blank"
                          >
                            {card.name}
                          </Link>
                          <p className="text-xs text-starlight/50">
                            by {card.creator || 'Unknown'} • {card.uploader?.username || 'Anonymous'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={card.visibility}
                        onChange={(e) => handleVisibilityChange(card.id, e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium border-0 focus:outline-none focus:ring-2 focus:ring-nebula ${
                          card.visibility === 'public'
                            ? 'bg-green-500/20 text-green-400'
                            : card.visibility === 'nsfw_only'
                            ? 'bg-orange-500/20 text-orange-400'
                            : card.visibility === 'unlisted'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        <option value="public">Public</option>
                        <option value="nsfw_only">NSFW Only</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={card.moderationState}
                        onChange={(e) => handleModerationChange(card.id, e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium border-0 focus:outline-none focus:ring-2 focus:ring-nebula ${
                          card.moderationState === 'ok'
                            ? 'bg-green-500/20 text-green-400'
                            : card.moderationState === 'review'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        <option value="ok">OK</option>
                        <option value="review">Review</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-starlight/70">
                      <div className="flex items-center gap-2">
                        <span title="Votes">👍 {card.upvotes - card.downvotes}</span>
                        <span title="Downloads">⬇️ {card.downloadsCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {card.reportsCount > 0 ? (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-medium">
                          {card.reportsCount}
                        </span>
                      ) : (
                        <span className="text-starlight/30 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-starlight/70">
                      {formatDate(card.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/card/${card.slug}`}
                          target="_blank"
                          className="p-1.5 hover:bg-nebula/20 rounded transition-colors text-starlight/70 hover:text-starlight"
                          title="View Card"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </Link>
                        <button
                          onClick={() => handleDelete(card.id, card.name)}
                          className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-red-400"
                          title="Delete Card"
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
              Showing {cards.length} of {pagination.total} cards
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
    </div>
  );
}
