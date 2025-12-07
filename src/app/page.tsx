'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AppShell } from '@/components/layout';
import { Button } from '@/components/ui';
import { FeedSortControls, type FeedSortOption, type SortOrder } from '@/components/feed';
import { useAuth } from '@/lib/auth/context';

interface FeedCard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator: string | null;
  thumbnailPath: string | null;
  upvotes: number;
  downloadsCount: number;
  favoritesCount: number;
  createdAt: number;
  modifiedAt: number;
  reason: 'followed_user' | 'followed_tag' | 'trending';
  uploader: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
}

interface FeedResponse {
  items: FeedCard[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

function ReasonBadge({ reason }: { reason: FeedCard['reason'] }) {
  const config = {
    followed_user: { label: 'From Following', className: 'bg-blue-500/20 text-blue-400' },
    followed_tag: { label: 'Followed Tag', className: 'bg-purple-500/20 text-purple-400' },
    trending: { label: 'Trending', className: 'bg-amber-500/20 text-amber-400' },
  };
  const { label, className } = config[reason];
  return <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

function FeedCardItem({ card }: { card: FeedCard }) {
  return (
    <Link
      href={`/card/${card.slug}`}
      className="group glass-card rounded-xl overflow-hidden hover:border-nebula/50 transition-all duration-200"
    >
      {/* Image */}
      <div className="relative aspect-[3/4] bg-cosmic-teal/30">
        {card.thumbnailPath ? (
          <Image
            src={card.thumbnailPath}
            alt={card.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-starlight/20">
            ?
          </div>
        )}
        <div className="absolute top-2 left-2">
          <ReasonBadge reason={card.reason} />
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <h3 className="font-semibold text-starlight group-hover:text-nebula transition-colors line-clamp-1">
          {card.name}
        </h3>

        {card.creator && (
          <p className="text-xs text-starlight/60">by {card.creator}</p>
        )}

        {card.description && (
          <p className="text-xs text-starlight/50 line-clamp-2">{card.description}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-starlight/50">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
            {card.upvotes}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {card.downloadsCount}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            {card.favoritesCount || 0}
          </span>
        </div>

        {/* Uploader */}
        {card.uploader && (
          <Link
            href={`/user/${card.uploader.username}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 pt-2 border-t border-nebula/10 hover:bg-nebula/10 -mx-3 px-3 -mb-3 pb-3 rounded-b-xl transition-colors"
          >
            {card.uploader.avatarUrl ? (
              <Image
                src={card.uploader.avatarUrl}
                alt={card.uploader.username}
                width={20}
                height={20}
                className="rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-nebula/30 flex items-center justify-center text-xs">
                {card.uploader.username[0].toUpperCase()}
              </div>
            )}
            <span className="text-xs text-starlight/60 hover:text-nebula transition-colors">
              {card.uploader.displayName || card.uploader.username}
            </span>
          </Link>
        )}
      </div>
    </Link>
  );
}

export default function FeedPage() {
  const { user } = useAuth();
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<FeedSortOption>('newest');
  const [order, setOrder] = useState<SortOrder>('desc');

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
        const data: FeedResponse = await res.json();
        setCards(prev => append ? [...prev, ...data.items] : data.items);
        setHasMore(data.hasMore);
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

        {/* Feed grid */}
        {isLoading && cards.length === 0 ? (
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {cards.map(card => (
                <FeedCardItem key={card.id} card={card} />
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="mt-8 text-center">
                <Button onClick={loadMore} variant="secondary" disabled={isLoading}>
                  {isLoading ? 'Loading...' : 'Load More'}
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
      </div>
    </AppShell>
  );
}
