'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { CardListItem, SortOption, PaginatedResponse } from '@/types/card';
import { useSettings } from '@/lib/settings';

const CARDS_PER_PAGE = 20;

interface TagGroup {
  category: string;
  tags: { id: number; name: string; slug: string; category: string | null; usage_count: number }[];
}

interface UseCardSearchReturn {
  // State
  cards: CardListItem[];
  tags: TagGroup[];
  isLoading: boolean;
  total: number;

  // Pagination
  page: number;
  totalPages: number;
  goToPage: (page: number) => void;

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Computed pagination
  const totalPages = Math.ceil(total / CARDS_PER_PAGE);

  // Filter state from URL - sync with URL changes
  const urlSearch = searchParams.get('search') || '';
  const urlTags = useMemo(() => searchParams.get('tags')?.split(',').filter(Boolean) || [], [searchParams]);
  const urlExcludeTags = useMemo(() => searchParams.get('excludeTags')?.split(',').filter(Boolean) || [], [searchParams]);
  const urlSort = (searchParams.get('sort') as SortOption) || 'newest';
  const urlMinTokens = searchParams.get('minTokens') || '';
  const urlHasAltGreetings = searchParams.get('hasAltGreetings') === 'true';
  const urlHasLorebook = searchParams.get('hasLorebook') === 'true';
  const urlHasEmbeddedImages = searchParams.get('hasEmbeddedImages') === 'true';
  const urlPage = parseInt(searchParams.get('page') || '1', 10);

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
  const urlTagsKey = urlTags.join(',');
  const urlExcludeTagsKey = urlExcludeTags.join(',');
  useEffect(() => {
    setSearch(urlSearch);
    setIncludeTags(urlTags);
    setExcludeTags(urlExcludeTags);
    setSort(urlSort);
    setMinTokens(urlMinTokens);
    setHasAltGreetings(urlHasAltGreetings);
    setHasLorebook(urlHasLorebook);
    setHasEmbeddedImages(urlHasEmbeddedImages);
    setPage(urlPage);
  }, [urlSearch, urlTags, urlExcludeTags, urlTagsKey, urlExcludeTagsKey, urlSort, urlMinTokens, urlHasAltGreetings, urlHasLorebook, urlHasEmbeddedImages, urlPage]);

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

  // Track if we're currently fetching to avoid double-fetches
  const isFetchingRef = useRef(false);
  // Track the last fetched params to avoid redundant fetches
  const lastFetchRef = useRef<string>('');

  // Fetch cards for current page
  const fetchCards = useCallback(async (targetPage: number) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (includeTags.length > 0) params.set('tags', includeTags.join(','));
    if (allExcludeTags.length > 0) params.set('excludeTags', allExcludeTags.join(','));
    params.set('sort', sort);
    params.set('page', targetPage.toString());
    params.set('limit', CARDS_PER_PAGE.toString());
    if (minTokens) params.set('minTokens', minTokens);
    if (hasAltGreetings) params.set('hasAltGreetings', 'true');
    if (hasLorebook) params.set('hasLorebook', 'true');
    if (hasEmbeddedImages) params.set('hasEmbeddedImages', 'true');

    const fetchKey = params.toString();

    // Skip if we just fetched with these exact params
    if (fetchKey === lastFetchRef.current || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    lastFetchRef.current = fetchKey;
    setIsLoading(true);

    try {
      const res = await fetch(`/api/cards?${fetchKey}`);
      if (!res.ok) {
        console.error('Failed to fetch cards:', res.status, res.statusText);
        return;
      }
      const data: PaginatedResponse<CardListItem> = await res.json();

      setCards(data.items || []);
      setTotal(data.total ?? 0);
    } catch (error) {
      console.error('Failed to fetch cards:', error);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [search, includeTags, allExcludeTags, sort, minTokens, hasAltGreetings, hasLorebook, hasEmbeddedImages]);

  // Update URL when filters or page change
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
    if (page > 1) params.set('page', page.toString());

    const newUrl = params.toString() ? `?${params.toString()}` : '/explore';
    router.replace(newUrl, { scroll: false });
  }, [search, includeTags, excludeTags, sort, minTokens, hasAltGreetings, hasLorebook, hasEmbeddedImages, page, router]);

  // Single effect to fetch cards - runs when page or filters change
  const filtersKey = useMemo(() =>
    JSON.stringify({ includeTags, allExcludeTags, sort, hasAltGreetings, hasLorebook, hasEmbeddedImages }),
    [includeTags, allExcludeTags, sort, hasAltGreetings, hasLorebook, hasEmbeddedImages]
  );

  const prevFiltersKeyRef = useRef(filtersKey);

  useEffect(() => {
    const filtersChanged = prevFiltersKeyRef.current !== filtersKey;
    prevFiltersKeyRef.current = filtersKey;

    if (filtersChanged && page !== 1) {
      // Filters changed, reset to page 1
      setPage(1);
      // fetchCards will be called by the page change
    } else {
      // Either page changed or initial load
      fetchCards(page);
    }
  }, [page, filtersKey, fetchCards]);

  // Debounced search - reset to page 1
  useEffect(() => {
    const timer = setTimeout(() => {
      if (page !== 1) {
        setPage(1);
      } else {
        // Already on page 1, just fetch
        lastFetchRef.current = ''; // Clear to force refetch
        fetchCards(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, minTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to a specific page
  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  const handleSearch = () => {
    setPage(1);
    fetchCards(1);
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
    setPage(1);
  };

  const hasActiveFilters = includeTags.length > 0 || excludeTags.length > 0 || !!minTokens || hasAltGreetings || hasLorebook || hasEmbeddedImages || !!search;

  return {
    cards,
    tags,
    isLoading,
    total,
    page,
    totalPages,
    goToPage,
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
    handleSearch,
    handleClear,
    hasActiveFilters,
  };
}
