'use client';

import { useState, useMemo, useEffect } from 'react';
import { AppShell } from '@/components/layout';
import type { CardDetail } from '@/types/card';
import { buildCardExportFilename } from '@/lib/utils';
import {
  CardHero,
  SectionTabs,
  UploaderInfo,
  NotesSection,
  CharacterSection,
  GreetingsSection,
  LorebookSection,
  AssetsSection,
  CommentsSection,
  type Section,
} from './components';
import type { CharacterCardV3 } from '@/types/card';

interface CardDetailClientProps {
  card: CardDetail;
}

// Helper: Check if card data contains external image URLs that need processing
function hasExternalImages(cardData: Record<string, unknown>): boolean {
  const jsonStr = JSON.stringify(cardData);
  // Check for http:// or https:// image URLs (that aren't already hosted by us)
  return /https?:\/\/[^\s"']+\.(jpg|jpeg|png|gif|webp|avif)(\?[^\s"']*)?/i.test(jsonStr);
}

export function CardDetailClient({ card }: CardDetailClientProps) {
  const [activeSection, setActiveSection] = useState<Section>('notes');
  const [displayCard, setDisplayCard] = useState<CardDetail>(card);
  const needsProcessing = useMemo(() => hasExternalImages(displayCard.cardData as unknown as Record<string, unknown>), [displayCard.cardData]);
  const [isProcessing, setIsProcessing] = useState<boolean>(needsProcessing);
  const [processingAttempted, setProcessingAttempted] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [viewAnyway, setViewAnyway] = useState<boolean>(false);

  // Auto-trigger image processing if needed
  useEffect(() => {
    if (!needsProcessing) {
      setIsProcessing(false);
      return;
    }
    if (processingAttempted) return;

    let cancelled = false;
    setProcessingAttempted(true);
    setIsProcessing(true);
    setProcessingError(null);

    (async () => {
      try {
        const res = await fetch(`/api/cards/${displayCard.slug}/process-images`, { method: 'POST' });
        const data = (await res.json().catch(() => ({}))) as { processedImages?: number; error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to process images');
        }

        // If server found nothing to process, don't block the page.
        if ((data.processedImages || 0) === 0) {
          setIsProcessing(false);
          return;
        }

        // Poll until card data no longer contains external image URLs.
        const startedAt = Date.now();
        let delayMs = 2000;

        while (!cancelled && Date.now() - startedAt < 90_000) {
          await new Promise((r) => setTimeout(r, delayMs));
          delayMs = Math.min(10_000, Math.round(delayMs * 1.5));

          const checkRes = await fetch(`/api/cards/${displayCard.slug}?t=${Date.now()}`, { cache: 'no-store' });
          if (!checkRes.ok) continue;
          const updated = (await checkRes.json()) as CardDetail;
          if (cancelled) return;

          setDisplayCard(updated);

          if (!hasExternalImages(updated.cardData as unknown as Record<string, unknown>)) {
            setIsProcessing(false);
            return;
          }
        }

        // Timeout: stop blocking and let the user view the card.
        setIsProcessing(false);
      } catch (err) {
        if (cancelled) return;
        setProcessingError(err instanceof Error ? err.message : 'Failed to process images');
        setIsProcessing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsProcessing, processingAttempted, displayCard.slug]);

  // Check if card has NSFW tag (for passing to child components)
  const isNsfw = displayCard.tags.some(tag => tag.slug === 'nsfw');

  // Calculate permanent token count (always sent: description + personality + scenario + system_prompt + post_history)
  const permanentTokens = useMemo(() => {
    return displayCard.tokens.description +
           displayCard.tokens.personality +
           displayCard.tokens.scenario +
           displayCard.tokens.systemPrompt +
           displayCard.tokens.postHistory;
  }, [displayCard.tokens]);

  // Check for assets (V3 cards or saved assets from packages)
  const v3Assets = displayCard.cardData.spec === 'chara_card_v3'
    ? (displayCard.cardData as CharacterCardV3).data.assets
    : undefined;
  const hasSavedAssets = !!(displayCard.savedAssets && displayCard.savedAssets.length > 0);
  const hasV3Assets = !!(v3Assets && v3Assets.length > 0);
  const hasAssets = hasV3Assets || hasSavedAssets;

  const sections: { id: Section; label: string; available: boolean }[] = [
    { id: 'notes', label: "Creator's Notes", available: true },
    { id: 'character', label: 'Character Card', available: true },
    { id: 'greetings', label: 'Greetings', available: displayCard.hasAlternateGreetings || !!displayCard.cardData.data.first_mes },
    { id: 'lorebook', label: 'Lorebook', available: displayCard.hasLorebook },
    { id: 'assets', label: 'Assets', available: hasAssets },
    { id: 'comments', label: 'Comments', available: true },
  ];

  const handleDownload = async (format: 'png' | 'json' | 'original') => {
    const response = await fetch(`/api/cards/${displayCard.slug}/download?format=${format}`);
    if (response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Determine file extension based on format and sourceFormat
      let ext: string = format;
      if (format === 'original') {
        // Use the original source format extension
        const extMap: Record<string, string> = {
          'charx': 'charx',
          'voxta': 'voxpkg',
          'png': 'png',
          'json': 'json',
        };
        ext = extMap[displayCard.sourceFormat] || displayCard.sourceFormat;
      }
      a.download = buildCardExportFilename(displayCard, ext);
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <AppShell>
      <div data-card-page data-card-slug={displayCard.slug} data-card-format={displayCard.sourceFormat}>
      {/* Hero Section with Token Breakdown on right */}
      <CardHero
        card={displayCard}
        permanentTokens={permanentTokens}
        onDownload={handleDownload}
      />

      {/* Navigation Tabs */}
      <SectionTabs
        sections={sections}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      {/* Content */}
      <div className="w-full" data-card-content>
        {needsProcessing && isProcessing && !viewAnyway ? (
          /* Processing State - Only show message with refresh button */
          <div className="glass rounded-xl p-12 text-center space-y-6">
            <div className="space-y-2">
              <div className="text-2xl font-semibold text-starlight">Server Processing</div>
              <p className="text-starlight/70 max-w-md mx-auto">
                This card contains external images that are being downloaded and processed by the server.
                This may take up to 60 seconds.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3">
              <div className="w-2 h-2 rounded-full bg-nebula animate-pulse" />
              <div className="w-2 h-2 rounded-full bg-nebula animate-pulse delay-75" />
              <div className="w-2 h-2 rounded-full bg-nebula animate-pulse delay-150" />
            </div>

            {processingError ? (
              <div className="bg-red-500/20 border border-red-500/40 rounded-lg px-4 py-3 text-red-200/90">
                {processingError}
              </div>
            ) : null}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="btn-primary px-6 py-3 text-lg"
              >
                Refresh Page
              </button>
              <button
                onClick={() => setViewAnyway(true)}
                className="btn-secondary px-6 py-3 text-lg"
              >
                View Anyway
              </button>
            </div>

            <p className="text-sm text-starlight/50">
              The card content will update after processing completes.
            </p>
          </div>
        ) : (
          /* Normal State - Show all sections */
          <div className="glass rounded-xl p-6" data-card-section={activeSection}>
            {activeSection === 'notes' && (
              <NotesSection creatorNotes={displayCard.cardData.data.creator_notes || displayCard.creatorNotes} isNsfw={isNsfw} />
            )}

            {activeSection === 'character' && (
              <CharacterSection cardData={displayCard.cardData} tokens={displayCard.tokens} />
            )}

            {activeSection === 'greetings' && (
              <GreetingsSection
                firstMessage={displayCard.cardData.data.first_mes}
                alternateGreetings={displayCard.cardData.data.alternate_greetings}
                firstMessageTokens={displayCard.tokens.firstMes}
                isNsfw={isNsfw}
              />
            )}

            {activeSection === 'lorebook' && displayCard.cardData.data.character_book && (
              <LorebookSection characterBook={displayCard.cardData.data.character_book} />
            )}

            {activeSection === 'assets' && hasAssets && (
              <AssetsSection assets={v3Assets} savedAssets={displayCard.savedAssets} />
            )}

            {activeSection === 'comments' && (
              <CommentsSection cardId={displayCard.id} commentsCount={displayCard.commentsCount} />
            )}
          </div>
        )}

        {/* Uploader Info */}
        {displayCard.uploader && (
          <UploaderInfo uploader={displayCard.uploader} createdAt={displayCard.createdAt} />
        )}
      </div>
      </div>
    </AppShell>
  );
}
