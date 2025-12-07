'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import type { CardListItem, SourceFormat } from '@/types/card';
import { useSettings } from '@/lib/settings';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';
import { formatCount } from '@/lib/utils/format';

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
        'glass-card rounded-xl overflow-hidden group cursor-pointer transition-transform hover:scale-[1.02] block',
        settings.cardSize === 'large' && 'scale-100' // Base size when large mode
      )}
    >
      {/* Image container */}
      <div className={cn(
        'relative overflow-hidden',
        settings.cardSize === 'large' ? 'aspect-[3/4.5]' : 'aspect-[3/4]'
      )}>
        {(card.thumbnailPath || card.imagePath) ? (
          <Image
            src={card.thumbnailPath || card.imagePath!}
            alt={card.name}
            fill
            className={cn(
              'object-cover transition-all duration-300 group-hover:scale-105',
              shouldBlur && 'blur-xl hover:blur-none'
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

        {/* Format badge - top right */}
        <div className="absolute top-2 right-2">
          <FormatBadge format={card.sourceFormat} specVersion={card.specVersion} />
        </div>

        {/* Bottom info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          {/* Character name */}
          <h3 className="font-bold text-base text-white mb-0.5 line-clamp-1 group-hover:text-nebula transition-colors">
            {card.name}
          </h3>

          {/* Creator name and uploader - clickable */}
          <div className="text-xs text-starlight/70 line-clamp-1 mb-1.5">
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

          {/* Tags - truncated */}
          <div className="flex flex-wrap gap-1">
            {card.tags.slice(0, 3).map((tag) => (
              <Link
                key={tag.id}
                href={`/explore?tags=${tag.slug}`}
                onClick={handleTagClick}
                className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white/80 hover:bg-nebula/30 hover:text-white transition-colors"
              >
                {tag.name}
              </Link>
            ))}
            {card.tags.length > 3 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                +{card.tags.length - 3}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="p-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          {/* Votes */}
          <div className="flex items-center gap-1">
            <span className={card.score >= 0 ? 'text-aurora' : 'text-red-400'}>
              {card.score >= 0 ? '+' : ''}{card.score}
            </span>
          </div>

          {/* Downloads */}
          <div className="flex items-center gap-1 text-starlight/60">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
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
            <svg
              className="w-3.5 h-3.5"
              fill={isFavorited ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            <span>{formatCount(favoritesCount)}</span>
          </button>
        </div>

        {/* Tokens */}
        <div className="flex items-center gap-1 text-starlight/60">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span>{formatCount(card.tokensTotal)}</span>
        </div>
      </div>
    </Wrapper>
  );
}

