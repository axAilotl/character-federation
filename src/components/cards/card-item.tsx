'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { CardListItem, SourceFormat } from '@/types/card';
import { useSettings } from '@/lib/settings';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';
import { formatCount } from '@/lib/utils/format';
import { CoinIcon, ThumbsUpIcon, DownloadIcon, HeartIcon } from '@/components/ui';

// Format badge component - matches the style of other top row badges
function FormatBadge({ format, specVersion }: { format: SourceFormat; specVersion: string }) {
  // Determine what to display based on source format
  // charx/voxta show the package format, png/json show the spec version
  const isPackage = format === 'charx' || format === 'voxta';
  const label = isPackage ? format.toUpperCase() : specVersion.toUpperCase();

  return (
    <div className="px-1.5 py-0.5 rounded bg-black/60 text-xs text-starlight/80">
      {label}
    </div>
  );
}

// Check if a card is "new" (uploaded within last 7 days)
function isNewCard(createdAt: number): boolean {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return createdAt > sevenDaysAgo;
}

interface CardItemProps {
  card: CardListItem;
  onQuickView?: (card: CardListItem) => void;
}

export function CardItem({ card, onQuickView }: CardItemProps) {
  const { settings } = useSettings();
  const { user } = useAuth();
  // Initialize from card data (API returns isFavorited for authenticated users)
  const [isFavorited, setIsFavorited] = useState(card.isFavorited ?? false);
  const [favoritesCount, setFavoritesCount] = useState(card.favoritesCount);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);

  // Check if card has NSFW tag
  const isNsfw = card.tags.some(tag => tag.slug === 'nsfw');
  const shouldBlur = settings.blurNsfwContent && isNsfw;

  // Only intercept click when onQuickView is provided (modal mode)
  const handleClick = onQuickView ? (e: React.MouseEvent) => {
    e.preventDefault();
    onQuickView(card);
  } : undefined;

  const handleCreatorClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!user || isTogglingFavorite) return;

    setIsTogglingFavorite(true);
    try {
      const response = await fetch(`/api/cards/${card.slug}/favorite`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setIsFavorited(data.data.isFavorited);
        setFavoritesCount(data.data.favoritesCount);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  // Use Link wrapper for direct navigation, div for modal mode
  const Wrapper = onQuickView ? 'div' : Link;
  const wrapperProps = onQuickView
    ? { onClick: handleClick }
    : { href: `/card/${card.slug}` };

  return (
    <Wrapper
      {...wrapperProps as any}
      className={cn(
        'glass-card rounded-xl overflow-hidden group cursor-pointer transition-transform hover:scale-[1.02] flex flex-col',
        settings.cardSize === 'large' ? 'aspect-[3/4.5]' : 'aspect-[3/4]'
      )}
    >
      {/* Image container - fills entire card */}
      <div className="relative overflow-hidden flex-1">
        {(card.thumbnailPath || card.imagePath) ? (
          <Image
            src={card.thumbnailPath || card.imagePath!}
            alt={card.name}
            fill
            className={cn(
              'object-cover transition-all duration-300 group-hover:scale-105',
              shouldBlur && 'blur-xl'
            )}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="w-full h-full bg-cosmic-teal/50 flex items-center justify-center">
            <span className="text-4xl text-starlight/30">?</span>
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

        {/* Metadata icons - top left */}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          {card.hasAlternateGreetings && card.alternateGreetingsCount > 0 && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/60 text-xs text-starlight/80" title="Total greetings (first + alternates)">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>{card.totalGreetingsCount}</span>
            </div>
          )}
          {card.hasLorebook && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/60 text-xs text-starlight/80">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {card.lorebookEntriesCount > 0 && <span>{card.lorebookEntriesCount}</span>}
            </div>
          )}
          {card.hasEmbeddedImages && card.embeddedImagesCount > 0 && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/60 text-xs text-starlight/80" title="Embedded images (links)">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{card.embeddedImagesCount}</span>
            </div>
          )}
          {card.hasAssets && card.assetsCount > 0 && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/60 text-xs text-starlight/80" title="Embedded assets (files)">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <span>{card.assetsCount}</span>
            </div>
          )}
        </div>

        {/* Format badge and collection badge - top right */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <FormatBadge format={card.sourceFormat} specVersion={card.specVersion} />
          {card.collectionId && card.collectionSlug && (
            <Link
              href={`/collection/${card.collectionSlug}`}
              onClick={(e) => e.stopPropagation()}
              className="px-1.5 py-0.5 rounded bg-purple-600 text-xs text-white font-medium hover:bg-purple-500 transition-colors"
              title={card.collectionName ? `Part of ${card.collectionName}` : 'Part of a collection'}
            >
              COLLECTION
            </Link>
          )}
        </div>

        {/* Bottom info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          {/* Status badges - NEW / Trending / Following - above character name */}
          <div className="flex flex-wrap gap-1 mb-1.5">
            {isNewCard(card.createdAt) && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/90 text-white font-medium">
                NEW
              </span>
            )}
            {card.feedReason === 'trending' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/90 text-white font-medium">
                Trending
              </span>
            )}
            {card.feedReason === 'followed_user' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/90 text-white font-medium">
                Following
              </span>
            )}
            {card.feedReason === 'followed_tag' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/90 text-white font-medium">
                Tag
              </span>
            )}
          </div>

          {/* Character name */}
          <h3 className="font-bold text-base text-white mb-0.5 line-clamp-1 group-hover:text-nebula transition-colors">
            {card.name}
          </h3>

          {/* Creator name and uploader - clickable - improved contrast */}
          <div className="text-xs text-starlight/90 line-clamp-1 mb-1.5">
            {card.creator && (
              <span>by {card.creator}</span>
            )}
            {card.uploader && (
              <Link
                href={`/user/${card.uploader.username}`}
                onClick={handleCreatorClick}
                className="hover:text-nebula transition-colors"
              >
                {card.creator ? ` (@${card.uploader.username})` : `by @${card.uploader.username}`}
              </Link>
            )}
          </div>

          {/* Tags - truncated - improved contrast */}
          {card.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {card.tags.slice(0, 3).map((tag) => (
                <Link
                  key={tag.id}
                  href={`/explore?tags=${tag.slug}`}
                  onClick={handleTagClick}
                  className="text-xs px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-200 hover:bg-nebula/50 hover:text-white transition-colors"
                >
                  {tag.name}
                </Link>
              ))}
              {card.tags.length > 3 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-400">
                  +{card.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="p-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          {/* NSFW indicator */}
          {isNsfw && (
            <span className="text-orange-400/60" title="NSFW">
              🔥
            </span>
          )}

          {/* Votes with thumbs up icon */}
          <div className="flex items-center gap-1">
            <ThumbsUpIcon className={cn('w-3.5 h-3.5', card.score >= 0 ? 'text-aurora' : 'text-red-400')} />
            <span className={card.score >= 0 ? 'text-aurora' : 'text-red-400'}>
              {card.score >= 0 ? '+' : ''}{card.score}
            </span>
          </div>

          {/* Downloads */}
          <div className="flex items-center gap-1 text-starlight/60">
            <DownloadIcon className="w-3.5 h-3.5" />
            <span>{formatCount(card.downloadsCount)}</span>
          </div>

          {/* Favorites - clickable button */}
          <button
            onClick={handleFavoriteClick}
            disabled={!user || isTogglingFavorite}
            className={cn(
              'flex items-center gap-1 transition-colors',
              user ? 'hover:text-pink-400 cursor-pointer' : 'cursor-default',
              isFavorited ? 'text-pink-400' : 'text-starlight/60'
            )}
            title={user ? (isFavorited ? 'Remove from favorites' : 'Add to favorites') : 'Login to favorite'}
          >
            <HeartIcon className="w-3.5 h-3.5" filled={isFavorited} />
            <span>{formatCount(favoritesCount)}</span>
          </button>
        </div>

        {/* Tokens with coin icon */}
        <div className="flex items-center gap-1 text-starlight/60">
          <CoinIcon className="w-3.5 h-3.5 text-solar" />
          <span>{formatCount(card.tokensTotal)}</span>
        </div>
      </div>
    </Wrapper>
  );
}

