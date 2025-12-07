'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { CardListItem, SortOption, PaginatedResponse, CardFilters } from '@/types/card';
import { useSettings } from '@/lib/settings';

interface TagGroup {
  category: string;
  tags: { id: number; name: string; slug: string; category: string | null; usage_count: number }[];
}

interface UseCardSearchReturn {
  // State
  cards: CardListItem[];
  tags: TagGroup[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;

  // Filter state
  search: string;
  setSearch: (value: string) => void;
  includeTags: string[];
  setIncludeTags: (tags: string[]) => void;
  excludeTags: string[];
  setExcludeTags: (tags: string[]) => void;
  sort: SortOption;
  setSort: (sort: SortOption) => void;
  minTokens: string;
  setMinTokens: (value: string) => void;

  // Advanced filters
  hasAltGreetings: boolean;
  setHasAltGreetings: (value: boolean) => void;
  hasLorebook: boolean;
  setHasLorebook: (value: boolean) => void;
  hasEmbeddedImages: boolean;
  setHasEmbeddedImages: (value: boolean) => void;

  // Actions
  loadMore: () => void;
  handleSearch: () => void;
  handleClear: () => void;

  // Computed
  hasActiveFilters: boolean;
}

export function useCardSearch(): UseCardSearchReturn {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings } = useSettings();

  // State
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [tags, setTags] = useState<TagGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Filter state from URL - sync with URL changes
  const urlSearch = searchParams.get('search') || '';
  const urlTags = searchParams.get('tags')?.split(',').filter(Boolean) || [];
  const urlExcludeTags = searchParams.get('excludeTags')?.split(',').filter(Boolean) || [];
  const urlSort = (searchParams.get('sort') as SortOption) || 'newest';
  const urlMinTokens = searchParams.get('minTokens') || '';
  const urlHasAltGreetings = searchParams.get('hasAltGreetings') === 'true';
  const urlHasLorebook = searchParams.get('hasLorebook') === 'true';
  const urlHasEmbeddedImages = searchParams.get('hasEmbeddedImages') === 'true';

  const [search, setSearch] = useState(urlSearch);
  const [includeTags, setIncludeTags] = useState<string[]>(urlTags);
  const [excludeTags, setExcludeTags] = useState<string[]>(urlExcludeTags);
  const [sort, setSort] = useState<SortOption>(urlSort);
  const [minTokens, setMinTokens] = useState<string>(urlMinTokens);

  // Advanced filters
  const [hasAltGreetings, setHasAltGreetings] = useState(urlHasAltGreetings);
  const [hasLorebook, setHasLorebook] = useState(urlHasLorebook);
  const [hasEmbeddedImages, setHasEmbeddedImages] = useState(urlHasEmbeddedImages);

  // Sync state when URL changes (e.g., from external navigation like tag/creator links)
  useEffect(() => {
    setSearch(urlSearch);
    setIncludeTags(urlTags);
    setExcludeTags(urlExcludeTags);
    setSort(urlSort);
    setMinTokens(urlMinTokens);
    setHasAltGreetings(urlHasAltGreetings);
    setHasLorebook(urlHasLorebook);
    setHasEmbeddedImages(urlHasEmbeddedImages);
  }, [urlSearch, urlTags.join(','), urlExcludeTags.join(','), urlSort, urlMinTokens, urlHasAltGreetings, urlHasLorebook, urlHasEmbeddedImages]);

  // Fetch tags on mount
  useEffect(() => {
    fetch('/api/tags')
      .then((res) => res.json())
      .then(setTags)
      .catch(console.error);
  }, []);

  // Merge user-selected excludeTags with banned tags from settings
  const allExcludeTags = useMemo(() => {
    const merged = new Set([...excludeTags, ...(settings.bannedTags || [])]);
    return Array.from(merged);
  }, [excludeTags, settings.bannedTags]);

  // Fetch cards
  const fetchCards = useCallback(async (resetPage = true) => {
    setIsLoading(true);

    const currentPage = resetPage ? 1 : page;
    if (resetPage) setPage(1);

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (includeTags.length > 0) params.set('tags', includeTags.join(','));
    // Use merged excludeTags (URL + banned from settings)
    if (allExcludeTags.length > 0) params.set('excludeTags', allExcludeTags.join(','));
    params.set('sort', sort);
    params.set('page', currentPage.toString());
    params.set('limit', '24');
    if (minTokens) params.set('minTokens', minTokens);
    if (hasAltGreetings) params.set('hasAltGreetings', 'true');
    if (hasLorebook) params.set('hasLorebook', 'true');
    if (hasEmbeddedImages) params.set('hasEmbeddedImages', 'true');

    try {
      const res = await fetch(`/api/cards?${params.toString()}`);
      if (!res.ok) {
        console.error('Failed to fetch cards:', res.status, res.statusText);
        return;
      }
      const data: PaginatedResponse<CardListItem> = await res.json();

      if (resetPage) {
        setCards(data.items || []);
      } else {
        setCards((prev) => [...prev, ...(data.items || [])]);
      }
      setHasMore(data.hasMore ?? false);
      setTotal(data.total ?? 0);
    } catch (error) {
      console.error('Failed to fetch cards:', error);
    } finally {
      setIsLoading(false);
    }
  }, [search, includeTags, allExcludeTags, sort, page, minTokens, hasAltGreetings, hasLorebook, hasEmbeddedImages]);

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (includeTags.length > 0) params.set('tags', includeTags.join(','));
    if (excludeTags.length > 0) params.set('excludeTags', excludeTags.join(','));
    if (sort !== 'newest') params.set('sort', sort);
    if (minTokens) params.set('minTokens', minTokens);
    if (hasAltGreetings) params.set('hasAltGreetings', 'true');
    if (hasLorebook) params.set('hasLorebook', 'true');
    if (hasEmbeddedImages) params.set('hasEmbeddedImages', 'true');

    const newUrl = params.toString() ? `?${params.toString()}` : '/explore';
    router.replace(newUrl, { scroll: false });
  }, [search, includeTags, excludeTags, sort, minTokens, hasAltGreetings, hasLorebook, hasEmbeddedImages, router]);

  // Fetch cards when filters change (including banned tags from settings)
  useEffect(() => {
    fetchCards(true);
  }, [includeTags, allExcludeTags, sort, hasAltGreetings, hasLorebook, hasEmbeddedImages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCards(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, minTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    setPage((p) => p + 1);
    fetchCards(false);
  };

  const handleSearch = () => {
    fetchCards(true);
  };

  const handleClear = () => {
    setSearch('');
    setIncludeTags([]);
    setExcludeTags([]);
    setSort('newest');
    setMinTokens('');
    setHasAltGreetings(false);
    setHasLorebook(false);
    setHasEmbeddedImages(false);
  };

  const hasActiveFilters = includeTags.length > 0 || excludeTags.length > 0 || !!minTokens || hasAltGreetings || hasLorebook || hasEmbeddedImages || !!search;

  return {
    cards,
    tags,
    isLoading,
    hasMore,
    total,
    search,
    setSearch,
    includeTags,
    setIncludeTags,
    excludeTags,
    setExcludeTags,
    sort,
    setSort,
    minTokens,
    setMinTokens,
    hasAltGreetings,
    setHasAltGreetings,
    hasLorebook,
    setHasLorebook,
    hasEmbeddedImages,
    setHasEmbeddedImages,
    loadMore,
    handleSearch,
    handleClear,
    hasActiveFilters,
  };
}
