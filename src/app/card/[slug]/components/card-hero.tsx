'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Button, Badge } from '@/components/ui';
import type { CardDetail, SourceFormat } from '@/types/card';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';

// Format badge component
function FormatBadge({ format, specVersion, className }: { format: SourceFormat; specVersion: string; className?: string }) {
  const isPackage = format === 'charx' || format === 'voxta';
  const label = isPackage ? format.toUpperCase() : specVersion.toUpperCase();

  const colorClasses = {
    charx: 'bg-amber-500 text-white',
    voxta: 'bg-purple-500 text-white',
    v2: 'bg-blue-500 text-white',
    v3: 'bg-emerald-500 text-white',
  };

  const colorClass = isPackage
    ? colorClasses[format as 'charx' | 'voxta']
    : colorClasses[specVersion as 'v2' | 'v3'] || 'bg-gray-500 text-white';

  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-semibold uppercase', colorClass, className)}>
      {label}
    </span>
  );
}

interface CardHeroProps {
  card: CardDetail;
  permanentTokens: number;
  onDownload: (format: 'png' | 'json' | 'original') => void;
}

// Get download button label based on source format
function getDownloadLabel(sourceFormat: string): string {
  switch (sourceFormat) {
    case 'charx': return 'Download CharX';
    case 'voxta': return 'Download Voxta';
    default: return 'Download PNG';
  }
}

// Get download format param based on source format
function getDownloadFormat(sourceFormat: string): 'png' | 'original' {
  return sourceFormat === 'charx' || sourceFormat === 'voxta' ? 'original' : 'png';
}

type CardVisibility = 'public' | 'private' | 'unlisted' | 'nsfw_only' | 'blocked';

const VISIBILITY_OPTIONS: { value: CardVisibility; label: string; icon: string }[] = [
  { value: 'public', label: 'Public', icon: '🌐' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔗' },
  { value: 'private', label: 'Private', icon: '🔒' },
];

function VisibilityBadge({ visibility }: { visibility: CardVisibility }) {
  const config: Record<CardVisibility, { label: string; className: string; icon: string }> = {
    public: { label: 'Public', className: 'bg-green-500/20 text-green-400', icon: '🌐' },
    private: { label: 'Private', className: 'bg-red-500/20 text-red-400', icon: '🔒' },
    unlisted: { label: 'Unlisted', className: 'bg-yellow-500/20 text-yellow-400', icon: '🔗' },
    nsfw_only: { label: 'NSFW Only', className: 'bg-pink-500/20 text-pink-400', icon: '🔞' },
    blocked: { label: 'Blocked', className: 'bg-gray-500/20 text-gray-400', icon: '⛔' },
  };
  const { label, className, icon } = config[visibility] || config.public;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>
      {icon} {label}
    </span>
  );
}

export function CardHero({ card, permanentTokens, onDownload }: CardHeroProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoritesCount, setFavoritesCount] = useState(card.favoritesCount);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [currentVisibility, setCurrentVisibility] = useState<CardVisibility>(card.visibility);
  const [isEditingVisibility, setIsEditingVisibility] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);

  const isOwner = user && card.uploader?.id === user.id;

  useEffect(() => {
    if (user && card) {
      fetch(`/api/cards/${card.slug}/favorite`)
        .then(res => res.json())
        .then(data => {
          if (data.data?.isFavorited !== undefined) {
            setIsFavorited(data.data.isFavorited);
          }
        })
        .catch(() => {});
    }
  }, [user, card]);

  const handleFavoriteClick = async () => {
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

  const handleVisibilityChange = async (newVisibility: CardVisibility) => {
    if (newVisibility === currentVisibility) {
      setIsEditingVisibility(false);
      return;
    }

    setIsUpdatingVisibility(true);
    try {
      const res = await fetch(`/api/cards/${card.slug}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });

      if (res.ok) {
        setCurrentVisibility(newVisibility);
        setIsEditingVisibility(false);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update visibility');
      }
    } catch {
      alert('An error occurred while updating visibility');
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${card.name}"? This cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/cards/${card.slug}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/explore');
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete card');
      }
    } catch {
      alert('An error occurred while deleting the card');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden mb-0">
      <div className="absolute inset-0 bg-gradient-to-r from-deep-space via-deep-space/80 to-transparent z-10" />

      {(card.thumbnailPath || card.imagePath) && (
        <div className="absolute inset-0">
          <Image
            src={card.thumbnailPath || card.imagePath!}
            alt=""
            fill
            className="object-cover opacity-30 blur-sm"
          />
        </div>
      )}

      <div className="relative z-20 flex flex-col md:flex-row gap-6 p-6">
        {/* Card image */}
        <div className="flex-shrink-0">
          <div className="relative w-52 h-72 rounded-lg overflow-hidden border-2 border-nebula/30 shadow-xl">
            {(card.thumbnailPath || card.imagePath) ? (
              <Image
                src={card.thumbnailPath || card.imagePath!}
                alt={card.name}
                fill
                className="object-cover"
                priority
              />
            ) : (
              <div className="w-full h-full bg-cosmic-teal/50 flex items-center justify-center">
                <span className="text-6xl text-starlight/30">?</span>
              </div>
            )}
          </div>
        </div>

        {/* Card info */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1">
            <h1 className="text-3xl font-bold gradient-text mb-1">{card.name}</h1>

            {card.creator && (
              <Link
                href={`/explore?search=${encodeURIComponent(card.creator)}`}
                className="text-sm text-starlight/60 hover:text-nebula mb-2 block"
              >
                by <span className="text-nebula">{card.creator}</span>
              </Link>
            )}

            <p className="text-starlight/70 text-sm mb-3 line-clamp-2">
              {card.description || 'No description provided.'}
            </p>

            {/* Tags */}
            {card.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {card.tags.map((tag) => (
                  <Link
                    key={tag.id}
                    href={`/explore?tags=${tag.slug}`}
                    className="text-xs px-2 py-1 rounded-full bg-nebula/20 text-nebula hover:bg-nebula/30 transition-colors"
                  >
                    {tag.name}
                  </Link>
                ))}
              </div>
            )}

            {/* Voting controls + Stats row */}
            <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-lg bg-deep-space/50">
              {/* Voting buttons */}
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg hover:bg-aurora/20 text-starlight/60 hover:text-aurora transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <span className={`font-bold text-lg ${card.score >= 0 ? 'text-aurora' : 'text-red-400'}`}>
                  {card.score >= 0 ? '+' : ''}{card.score}
                </span>
                <button className="p-2 rounded-lg hover:bg-red-400/20 text-starlight/60 hover:text-red-400 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <span className="text-xs text-starlight/40 ml-1">
                  ({card.upvotes} up / {card.downvotes} down)
                </span>
              </div>

              <div className="w-px h-6 bg-nebula/20" />

              {/* Favorites - interactive */}
              <button
                onClick={handleFavoriteClick}
                disabled={!user || isTogglingFavorite}
                className={cn(
                  'flex items-center gap-1.5 transition-colors',
                  user ? 'hover:text-pink-400 cursor-pointer' : 'cursor-default',
                  isFavorited ? 'text-pink-400' : 'text-starlight/60'
                )}
                title={user ? (isFavorited ? 'Remove from favorites' : 'Add to favorites') : 'Login to favorite'}
              >
                <svg
                  className="w-5 h-5"
                  fill={isFavorited ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span>{favoritesCount}</span>
              </button>

              <div className="w-px h-6 bg-nebula/20" />

              {/* Downloads count */}
              <div className="flex items-center gap-1.5 text-starlight/60">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>{card.downloadsCount.toLocaleString()}</span>
              </div>

              <FormatBadge format={card.sourceFormat} specVersion={card.specVersion} />

              {/* Visibility badge with edit dropdown */}
              <div className="relative">
                {isOwner && !isEditingVisibility ? (
                  <button
                    onClick={() => setIsEditingVisibility(true)}
                    className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                    title="Click to change visibility"
                  >
                    <VisibilityBadge visibility={currentVisibility} />
                    <svg className="w-3 h-3 text-starlight/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                ) : isOwner && isEditingVisibility ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={currentVisibility}
                      onChange={(e) => handleVisibilityChange(e.target.value as CardVisibility)}
                      disabled={isUpdatingVisibility}
                      className="px-2 py-1 text-xs bg-deep-space border border-nebula/30 rounded text-starlight"
                    >
                      {VISIBILITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.icon} {opt.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setIsEditingVisibility(false)}
                      className="text-starlight/50 hover:text-starlight"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <VisibilityBadge visibility={currentVisibility} />
                )}
              </div>

              {/* Asset count for charx/voxta */}
              {card.hasAssets && card.assetsCount > 0 && (
                <>
                  <div className="w-px h-6 bg-nebula/20" />
                  <Badge variant="outline" size="sm" className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                    </svg>
                    {card.assetsCount} Asset{card.assetsCount !== 1 ? 's' : ''}
                  </Badge>
                </>
              )}

              {/* Feature indicators */}
              {card.hasAlternateGreetings && card.alternateGreetingsCount > 0 && (
                <Badge variant="info" size="sm" className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {card.totalGreetingsCount} Greetings
                </Badge>
              )}
              {card.hasLorebook && (
                <Badge variant="success" size="sm" className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  {card.lorebookEntriesCount} Lorebook
                </Badge>
              )}
              {card.hasEmbeddedImages && (
                <Badge variant="warning" size="sm" className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {card.embeddedImagesCount} Image{card.embeddedImagesCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => onDownload(getDownloadFormat(card.sourceFormat))}>
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {getDownloadLabel(card.sourceFormat)}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onDownload('json')}>
                Export JSON
              </Button>
              <Button variant="ghost" size="sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </Button>

              {/* Admin delete button */}
              {user?.isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="text-red-400 hover:text-red-300 hover:bg-red-400/20"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Token Breakdown - Right side box */}
        <div className="flex-shrink-0 w-full md:w-56">
          <div className="glass rounded-lg p-4 border border-nebula/20">
            <h3 className="text-sm font-semibold text-starlight/80 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Token Breakdown
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-starlight/50">Description</span>
                <span>{card.tokens.description.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-starlight/50">Personality</span>
                <span>{card.tokens.personality.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-starlight/50">Scenario</span>
                <span>{card.tokens.scenario.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-starlight/50">First Message</span>
                <span>{card.tokens.firstMes.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-starlight/50">Examples</span>
                <span>{card.tokens.mesExample.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-starlight/50">System Prompt</span>
                <span>{card.tokens.systemPrompt.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-starlight/50">Post History</span>
                <span>{card.tokens.postHistory.toLocaleString()}</span>
              </div>
              <div className="border-t border-nebula/20 pt-2 mt-2">
                <div className="flex justify-between font-semibold">
                  <span className="text-nebula">Total</span>
                  <span className="text-nebula">{card.tokens.total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-starlight/40 mt-1">
                  <span>Permanent</span>
                  <span>{permanentTokens.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
