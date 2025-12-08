'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout';
import { CardGrid } from '@/components/cards/card-grid';
import { CardModal } from '@/components/cards/card-modal';
import { Button } from '@/components/ui';
import { FeedSortControls, type FeedSortOption, type SortOrder } from '@/components/feed';
import { useAuth } from '@/lib/auth/context';
import type { CardListItem, PaginatedResponse } from '@/types/card';

export default function FeedPage() {
  const { user } = useAuth();
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<FeedSortOption>('newest');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [selectedCard, setSelectedCard] = useState<CardListItem | null>(null);

  const fetchFeed = useCallback(async (pageNum: number, append = false) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: pageNum.toString(),
        limit: '24',
        sort,
        order,
      });
      const res = await fetch(`/api/feed?${params}`);
      if (res.ok) {
        const data: PaginatedResponse<CardListItem> = await res.json();
        setCards(prev => append ? [...prev, ...data.items] : data.items);
        setHasMore(data.hasMore);
        setTotal(data.total);
      }
    } catch (err) {
      console.error('Error fetching feed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [sort, order]);

  useEffect(() => {
    setPage(1);
    fetchFeed(1);
  }, [fetchFeed]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFeed(nextPage, true);
  };

  const handleSortChange = (newSort: FeedSortOption) => {
    setSort(newSort);
    setPage(1);
  };

  const handleOrderChange = (newOrder: SortOrder) => {
    setOrder(newOrder);
    setPage(1);
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold gradient-text mb-2">Your Feed</h1>
              <p className="text-starlight/60">
                {user
                  ? 'Cards from users and tags you follow, plus trending content'
                  : 'Trending and popular character cards'}
              </p>
            </div>
          </div>

          {/* Sort controls */}
          <FeedSortControls
            sort={sort}
            order={order}
            onSortChange={handleSortChange}
            onOrderChange={handleOrderChange}
            showForYou={!!user}
          />
        </div>

        {/* Personalization hint for non-logged in users */}
        {!user && (
          <div className="mb-6 p-4 glass rounded-lg border border-nebula/30">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-nebula flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-starlight">Want a personalized feed?</p>
                <p className="text-sm text-starlight/60">
                  <Link href="/login" className="text-nebula hover:underline">Log in</Link> to follow users and tags, and see content tailored to your interests.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Feed grid - uses same CardGrid component as explore */}
        {cards.length === 0 && !isLoading ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📭</div>
            <h2 className="text-xl font-semibold text-starlight mb-2">Your feed is empty</h2>
            <p className="text-starlight/60 mb-4">
              Start following users and tags to see personalized content here.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/explore">
                <Button variant="primary">Explore Cards</Button>
              </Link>
              <Link href="/settings">
                <Button variant="secondary">Manage Tags</Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <CardGrid
              cards={cards}
              isLoading={isLoading && cards.length === 0}
              onQuickView={setSelectedCard}
            />

            {/* Load more */}
            {hasMore && (
              <div className="mt-8 text-center">
                <Button onClick={loadMore} variant="secondary" disabled={isLoading}>
                  {isLoading ? 'Loading...' : `Load More (${cards.length} of ${total})`}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Loading indicator for pagination */}
        {isLoading && cards.length > 0 && (
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-2 text-starlight/60">
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading more...
            </div>
          </div>
        )}

        {/* Card Modal */}
        <CardModal
          card={selectedCard}
          isOpen={!!selectedCard}
          onClose={() => setSelectedCard(null)}
        />
      </div>
    </AppShell>
  );
}
