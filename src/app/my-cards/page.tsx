'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AppShell } from '@/components/layout';
import { Button, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';
import { formatCount } from '@/lib/utils/format';
import type { CardListItem } from '@/types/card';
import { CARDS_PER_PAGE } from '@/lib/constants';

type VisibilityFilter = 'all' | 'public' | 'private' | 'unlisted';
type SortOption = 'newest' | 'oldest' | 'name' | 'downloads' | 'upvotes';

interface MyCard extends CardListItem {
  visibility: 'public' | 'private' | 'unlisted';
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  const config = {
    public: { label: 'Public', className: 'bg-green-500/20 text-green-400' },
    private: { label: 'Private', className: 'bg-red-500/20 text-red-400' },
    unlisted: { label: 'Unlisted', className: 'bg-yellow-500/20 text-yellow-400' },
  };
  const { label, className } = config[visibility as keyof typeof config] || config.public;
  return <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

function MyCardItem({ card, onVisibilityChange, onDelete }: {
  card: MyCard;
  onVisibilityChange: (cardId: string, visibility: string) => void;
  onDelete: (cardId: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
      return;
    }
    setIsDeleting(true);
    onDelete(card.id);
  };

  return (
    <div className="glass-card rounded-xl overflow-hidden group relative">
      {/* Image */}
      <Link href={`/card/${card.slug}`} className="block">
        <div className="relative aspect-[3/4] bg-cosmic-teal/30">
          {(card.thumbnailPath || card.imagePath) ? (
            <Image
              src={card.thumbnailPath || card.imagePath!}
              alt={card.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl text-starlight/20">
              ?
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

          {/* Top badges */}
          <div className="absolute top-2 left-2">
            <VisibilityBadge visibility={card.visibility} />
          </div>

          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 p-3">
            <h3 className="font-bold text-base text-white mb-0.5 line-clamp-1">
              {card.name}
            </h3>
            {card.creator && (
              <p className="text-xs text-starlight/70">by {card.creator}</p>
            )}
          </div>
        </div>
      </Link>

      {/* Stats and actions bar */}
      <div className="p-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          <span className={card.score >= 0 ? 'text-aurora' : 'text-red-400'}>
            {card.score >= 0 ? '+' : ''}{card.score}
          </span>
          <span className="flex items-center gap-1 text-starlight/60">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {formatCount(card.downloadsCount)}
          </span>
          <span className="flex items-center gap-1 text-starlight/60">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            {formatCount(card.favoritesCount)}
          </span>
        </div>

        {/* Actions button */}
        <div className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 rounded hover:bg-nebula/20 text-starlight/60 hover:text-starlight transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {/* Actions dropdown */}
          {showActions && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
              <div className="absolute right-0 bottom-full mb-1 w-40 py-1 rounded-lg bg-deep-space/95 backdrop-blur-lg border border-nebula/30 shadow-xl z-50">
                <Link
                  href={`/card/${card.slug}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-starlight/80 hover:bg-nebula/20 hover:text-starlight transition-colors"
                  onClick={() => setShowActions(false)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View
                </Link>
                <div className="my-1 border-t border-nebula/20" />
                <button
                  onClick={() => {
                    onVisibilityChange(card.id, card.visibility === 'public' ? 'private' : 'public');
                    setShowActions(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-starlight/80 hover:bg-nebula/20 hover:text-starlight transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {card.visibility === 'public' ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    )}
                  </svg>
                  {card.visibility === 'public' ? 'Make Private' : 'Make Public'}
                </button>
                <button
                  onClick={() => {
                    onVisibilityChange(card.id, 'unlisted');
                    setShowActions(false);
                  }}
                  disabled={card.visibility === 'unlisted'}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-starlight/80 hover:bg-nebula/20 hover:text-starlight transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Make Unlisted
                </button>
                <div className="my-1 border-t border-nebula/20" />
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyCardsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [cards, setCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const totalPages = Math.ceil(total / CARDS_PER_PAGE);

  const fetchCards = useCallback(async (pageNum: number) => {
    if (!user) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pageNum.toString(),
        limit: CARDS_PER_PAGE.toString(),
        visibility: visibilityFilter,
        sort: sortBy,
        includePrivate: 'true',
      });

      const res = await fetch(`/api/users/${encodeURIComponent(user.username)}/cards?${params}`);
      if (!res.ok) throw new Error('Failed to fetch cards');

      const data = await res.json();
      setCards(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error('Error fetching cards:', err);
    } finally {
      setLoading(false);
    }
  }, [user, visibilityFilter, sortBy]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (user) {
      setPage(1);
      fetchCards(1);
    }
  }, [user, visibilityFilter, sortBy, fetchCards]);

  // Fetch when page changes
  useEffect(() => {
    if (user && page > 1) {
      fetchCards(page);
    }
  }, [user, page, fetchCards]);

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  const handleVisibilityChange = async (cardId: string, newVisibility: string) => {
    try {
      const card = cards.find(c => c.id === cardId);
      if (!card) return;

      const res = await fetch(`/api/cards/${card.slug}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });

      if (res.ok) {
        setCards(prev => prev.map(c =>
          c.id === cardId ? { ...c, visibility: newVisibility as MyCard['visibility'] } : c
        ));
      }
    } catch (err) {
      console.error('Error updating visibility:', err);
    }
  };

  const handleDelete = async (cardId: string) => {
    try {
      const card = cards.find(c => c.id === cardId);
      if (!card) return;

      const res = await fetch(`/api/cards/${card.slug}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setCards(prev => prev.filter(c => c.id !== cardId));
        setTotal(prev => prev - 1);
      }
    } catch (err) {
      console.error('Error deleting card:', err);
    }
  };

  // Auth loading
  if (authLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-nebula"></div>
        </div>
      </AppShell>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <AppShell>
        <div className="text-center py-24">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-starlight mb-2">Login Required</h1>
          <p className="text-starlight/60 mb-4">
            You need to be logged in to view your cards.
          </p>
          <Link href="/login">
            <Button variant="primary">Log In</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold gradient-text mb-2">My Cards</h1>
              <p className="text-starlight/60">
                Manage your uploaded character cards
              </p>
            </div>
            <Link href="/upload">
              <Button variant="primary">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Upload New
              </Button>
            </Link>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            {/* Visibility filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-starlight/60">Visibility:</span>
              <div className="flex gap-1">
                {(['all', 'public', 'private', 'unlisted'] as VisibilityFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setVisibilityFilter(filter)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm transition-colors capitalize',
                      visibilityFilter === filter
                        ? 'bg-nebula/30 text-nebula border border-nebula/50'
                        : 'bg-cosmic-teal/30 text-starlight/70 hover:bg-cosmic-teal/50 hover:text-starlight border border-transparent'
                    )}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-starlight/60">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-1.5 rounded-lg bg-cosmic-teal/30 text-starlight border border-nebula/30 text-sm"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                <option value="downloads">Downloads</option>
                <option value="upvotes">Upvotes</option>
              </select>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mb-6 text-sm">
          <span className="text-starlight/60">
            Total: <span className="text-starlight font-medium">{total}</span> cards
          </span>
        </div>

        {/* Cards grid */}
        {loading && cards.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-[3/4] bg-cosmic-teal/50" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-cosmic-teal/50 rounded w-3/4" />
                  <div className="h-3 bg-cosmic-teal/50 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📦</div>
            <h2 className="text-xl font-semibold text-starlight mb-2">No cards found</h2>
            <p className="text-starlight/60 mb-4">
              {visibilityFilter === 'all'
                ? "You haven't uploaded any cards yet."
                : `You don't have any ${visibilityFilter} cards.`}
            </p>
            <Link href="/upload">
              <Button variant="primary">Upload Your First Card</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {cards.map(card => (
                <MyCardItem
                  key={card.id}
                  card={card}
                  onVisibilityChange={handleVisibilityChange}
                  onDelete={handleDelete}
                />
              ))}
            </div>

            {!loading && totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={goToPage}
                className="mt-8"
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
