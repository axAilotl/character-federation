'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout';
import { CardGrid } from '@/components/cards/card-grid';
import { CardModal } from '@/components/cards/card-modal';
import { Pagination } from '@/components/ui';
import type { CardListItem } from '@/types/card';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';
import { formatMonthYear } from '@/lib/utils/format';
import { CARDS_PER_PAGE } from '@/lib/constants';

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileCss: string | null;
  isAdmin: boolean;
  createdAt: number;
  stats: {
    cardsCount: number;
    totalDownloads: number;
    totalUpvotes: number;
    favoritesCount: number;
  };
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
}

type Tab = 'cards' | 'favorites';

export default function UserProfilePage() {
  const params = useParams();
  const username = params.username as string;
  const { user: currentUser } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('cards');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedCard, setSelectedCard] = useState<CardListItem | null>(null);

  const totalPages = Math.ceil(total / CARDS_PER_PAGE);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const isOwnProfile = currentUser?.username === username;

  // Update local follow state when profile loads
  useEffect(() => {
    if (profile) {
      setIsFollowing(profile.isFollowing);
      setFollowersCount(profile.followersCount);
    }
  }, [profile]);

  const handleFollowToggle = async () => {
    if (!currentUser || isOwnProfile) return;

    setFollowLoading(true);
    try {
      const method = isFollowing ? 'DELETE' : 'POST';
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/follow`, {
        method,
      });

      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.isFollowing);
        setFollowersCount(data.followersCount);
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  // Fetch profile
  useEffect(() => {
    async function fetchProfile() {
      try {
        setLoading(true);
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('User not found');
          } else {
            throw new Error('Failed to fetch profile');
          }
          return;
        }
        const data = await res.json();
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [username]);

  // Fetch cards/favorites
  const fetchCards = useCallback(async (pageNum: number) => {
    if (!profile) return;

    try {
      setCardsLoading(true);
      const endpoint = activeTab === 'cards'
        ? `/api/users/${encodeURIComponent(username)}/cards`
        : `/api/users/${encodeURIComponent(username)}/favorites`;

      const res = await fetch(`${endpoint}?page=${pageNum}&limit=${CARDS_PER_PAGE}`);
      if (!res.ok) throw new Error('Failed to fetch cards');

      const data = await res.json();
      setCards(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error('Error fetching cards:', err);
    } finally {
      setCardsLoading(false);
    }
  }, [profile, username, activeTab]);

  // Reset to page 1 when tab changes
  useEffect(() => {
    if (profile) {
      setPage(1);
      fetchCards(1);
    }
  }, [profile, activeTab, fetchCards]);

  // Fetch when page changes
  useEffect(() => {
    if (profile && page > 1) {
      fetchCards(page);
    }
  }, [profile, page, fetchCards]);

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-nebula"></div>
        </div>
      </AppShell>
    );
  }

  if (error || !profile) {
    return (
      <AppShell>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">😕</div>
            <h1 className="text-2xl font-bold text-starlight mb-2">{error || 'User not found'}</h1>
            <p className="text-starlight/70 mb-4">The user you&apos;re looking for doesn&apos;t exist.</p>
            <Link href="/explore" className="text-nebula hover:underline">
              Browse cards
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="min-h-screen profile-container" data-profile data-username={profile.username}>
      {/* Profile Header */}
      <div className="bg-cosmic-teal/30 border-b border-nebula/20" data-profile-header>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-full bg-nebula/30 flex items-center justify-center text-4xl text-starlight flex-shrink-0" data-profile-avatar>
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                profile.username[0].toUpperCase()
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0" data-profile-info>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold text-starlight truncate" data-profile-displayname>
                  {profile.displayName || profile.username}
                </h1>
                {profile.isAdmin && (
                  <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-medium" data-profile-badge="admin">
                    Admin
                  </span>
                )}
              </div>
              {profile.displayName && (
                <p className="text-starlight/70 mb-2" data-profile-username>@{profile.username}</p>
              )}
              <p className="text-sm text-starlight/50" data-profile-joined>
                Joined {formatMonthYear(profile.createdAt)}
              </p>

              {/* Bio */}
              {profile.bio && (
                <p className="text-starlight/80 mt-3 max-w-xl whitespace-pre-wrap" data-profile-bio>
                  {profile.bio}
                </p>
              )}

              {/* Stats */}
              <div className="flex items-center gap-6 mt-4" data-profile-stats>
                <div className="text-center" data-stat="followers">
                  <div className="text-xl font-bold text-starlight" data-stat-value>{followersCount}</div>
                  <div className="text-xs text-starlight/50" data-stat-label>Followers</div>
                </div>
                <div className="text-center" data-stat="following">
                  <div className="text-xl font-bold text-starlight" data-stat-value>{profile.followingCount}</div>
                  <div className="text-xs text-starlight/50" data-stat-label>Following</div>
                </div>
                <div className="text-center" data-stat="cards">
                  <div className="text-xl font-bold text-starlight" data-stat-value>{profile.stats.cardsCount}</div>
                  <div className="text-xs text-starlight/50" data-stat-label>Cards</div>
                </div>
                <div className="text-center" data-stat="downloads">
                  <div className="text-xl font-bold text-starlight" data-stat-value>{profile.stats.totalDownloads}</div>
                  <div className="text-xs text-starlight/50" data-stat-label>Downloads</div>
                </div>
                <div className="text-center" data-stat="upvotes">
                  <div className="text-xl font-bold text-starlight" data-stat-value>{profile.stats.totalUpvotes}</div>
                  <div className="text-xs text-starlight/50" data-stat-label>Upvotes</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2" data-profile-actions>
              {isOwnProfile ? (
                <Link
                  href="/settings/profile"
                  className="px-4 py-2 bg-nebula/20 hover:bg-nebula/30 text-starlight rounded-lg transition-colors text-center"
                  data-action="edit"
                >
                  Edit Profile
                </Link>
              ) : currentUser && (
                <button
                  onClick={handleFollowToggle}
                  disabled={followLoading}
                  className={cn(
                    'px-4 py-2 rounded-lg transition-colors disabled:opacity-50',
                    isFollowing
                      ? 'bg-nebula/20 hover:bg-red-500/20 text-starlight hover:text-red-400'
                      : 'bg-nebula hover:bg-nebula/80 text-white'
                  )}
                  data-action="follow"
                  data-following={isFollowing}
                >
                  {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-nebula/20" data-profile-tabs>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('cards')}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors relative',
                activeTab === 'cards'
                  ? 'text-nebula'
                  : 'text-starlight/70 hover:text-starlight'
              )}
              data-tab="cards"
              data-active={activeTab === 'cards'}
            >
              Cards
              <span className="ml-2 text-xs text-starlight/50">
                {profile.stats.cardsCount}
              </span>
              {activeTab === 'cards' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nebula" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('favorites')}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors relative',
                activeTab === 'favorites'
                  ? 'text-nebula'
                  : 'text-starlight/70 hover:text-starlight'
              )}
              data-tab="favorites"
              data-active={activeTab === 'favorites'}
            >
              Favorites
              <span className="ml-2 text-xs text-starlight/50">
                {profile.stats.favoritesCount}
              </span>
              {activeTab === 'favorites' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nebula" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6" data-profile-content data-tab-content={activeTab}>
        {cards.length === 0 && !cardsLoading ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">
              {activeTab === 'cards' ? '📦' : '❤️'}
            </div>
            <h3 className="text-xl font-semibold mb-2 text-starlight">
              {activeTab === 'cards' ? 'No cards yet' : 'No favorites yet'}
            </h3>
            <p className="text-starlight/60">
              {activeTab === 'cards'
                ? isOwnProfile
                  ? "You haven't uploaded any cards yet."
                  : "This user hasn't uploaded any cards yet."
                : isOwnProfile
                  ? "You haven't favorited any cards yet."
                  : "This user hasn't favorited any cards yet."}
            </p>
            {isOwnProfile && activeTab === 'cards' && (
              <Link
                href="/upload"
                className="inline-block mt-4 px-4 py-2 bg-nebula hover:bg-nebula/80 text-white rounded-lg transition-colors"
              >
                Upload a Card
              </Link>
            )}
          </div>
        ) : (
          <>
            <CardGrid
              cards={cards}
              isLoading={cardsLoading}
              onQuickView={setSelectedCard}
            />

            {!cardsLoading && totalPages > 1 && (
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
