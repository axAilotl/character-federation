'use client';

import { useState, useMemo, useEffect } from 'react';
import { AppShell } from '@/components/layout';
import type { CardDetail } from '@/types/card';
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
import { sanitizeCss } from '@/lib/security/css-sanitizer';

interface CardDetailClientProps {
  card: CardDetail;
}

// Helper: Check if card data contains external image URLs that need processing
function hasExternalImages(cardData: Record<string, unknown>): boolean {
  const jsonStr = JSON.stringify(cardData);
  // Check for http:// or https:// image URLs (not already processed to r2://)
  return /https?:\/\/[^\s"']+\.(jpg|jpeg|png|gif|webp|avif)/i.test(jsonStr) &&
         !jsonStr.includes('r2://'); // If has r2://, processing already done
}

export function CardDetailClient({ card }: CardDetailClientProps) {
  const [activeSection, setActiveSection] = useState<Section>('notes');
  const [isProcessing, setIsProcessing] = useState(() => hasExternalImages(card.cardData));

  // Auto-trigger image processing if needed
  useEffect(() => {
    if (isProcessing) {
      // Trigger processing endpoint
      fetch(`/api/cards/${card.slug}/process-images`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          console.log('[ImageProcessing] Processing complete:', data);
          // Reload page after a short delay to show updated content
          setTimeout(() => window.location.reload(), 2000);
        })
        .catch(err => {
          console.error('[ImageProcessing] Failed:', err);
          // Allow manual refresh even if processing failed
        });
    }
  }, [isProcessing, card.slug]);

  // Check if card has NSFW tag (for passing to child components)
  const isNsfw = card.tags.some(tag => tag.slug === 'nsfw');

  // Calculate permanent token count (always sent: description + personality + scenario + system_prompt + post_history)
  const permanentTokens = useMemo(() => {
    return card.tokens.description +
           card.tokens.personality +
           card.tokens.scenario +
           card.tokens.systemPrompt +
           card.tokens.postHistory;
  }, [card.tokens]);

  // Extract custom CSS from creator notes if present
  // Use processed creator_notes from cardData (has rewritten image URLs)
  const processedCreatorNotes = card.cardData.data.creator_notes || card.creatorNotes;
  const customCss = useMemo(() => {
    if (!processedCreatorNotes) return null;
    const styleMatch = processedCreatorNotes.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (!styleMatch) return null;

    // Sanitize and scope CSS to card page only
    return sanitizeCss(styleMatch[1], {
      scope: '[data-card-page]',
      maxSelectors: 300,
    });
  }, [processedCreatorNotes]);

  // Inject custom CSS that persists across tabs
  useEffect(() => {
    if (!customCss) return;

    const styleId = `card-custom-css-${card.id}`;
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = customCss;

    return () => {
      styleEl?.remove();
    };
  }, [customCss, card.id]);

  // Check for assets (V3 cards or saved assets from packages)
  const v3Assets = card.cardData.spec === 'chara_card_v3'
    ? (card.cardData as CharacterCardV3).data.assets
    : undefined;
  const hasSavedAssets = !!(card.savedAssets && card.savedAssets.length > 0);
  const hasV3Assets = !!(v3Assets && v3Assets.length > 0);
  const hasAssets = hasV3Assets || hasSavedAssets;

  const sections: { id: Section; label: string; available: boolean }[] = [
    { id: 'notes', label: "Creator's Notes", available: true },
    { id: 'character', label: 'Character Card', available: true },
    { id: 'greetings', label: 'Greetings', available: card.hasAlternateGreetings || !!card.cardData.data.first_mes },
    { id: 'lorebook', label: 'Lorebook', available: card.hasLorebook },
    { id: 'assets', label: 'Assets', available: hasAssets },
    { id: 'comments', label: 'Comments', available: true },
  ];

  const handleDownload = async (format: 'png' | 'json' | 'original') => {
    const response = await fetch(`/api/cards/${card.slug}/download?format=${format}`);
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
        ext = extMap[card.sourceFormat] || card.sourceFormat;
      }
      a.download = `${card.slug}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <AppShell>
      <div data-card-page data-card-slug={card.slug} data-card-format={card.sourceFormat}>
      {/* Hero Section with Token Breakdown on right */}
      <CardHero
        card={card}
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
        {isProcessing ? (
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

            <button
              onClick={() => window.location.reload()}
              className="btn-primary px-6 py-3 text-lg"
            >
              Refresh Page
            </button>

            <p className="text-sm text-starlight/50">
              The card content will appear after processing completes
            </p>
          </div>
        ) : (
          /* Normal State - Show all sections */
          <div className="glass rounded-xl p-6" data-card-section={activeSection}>
            {activeSection === 'notes' && (
              <NotesSection creatorNotes={card.cardData.data.creator_notes || card.creatorNotes} isNsfw={isNsfw} />
            )}

            {activeSection === 'character' && (
              <CharacterSection cardData={card.cardData} tokens={card.tokens} />
            )}

            {activeSection === 'greetings' && (
              <GreetingsSection
                firstMessage={card.cardData.data.first_mes}
                alternateGreetings={card.cardData.data.alternate_greetings}
                firstMessageTokens={card.tokens.firstMes}
                isNsfw={isNsfw}
              />
            )}

            {activeSection === 'lorebook' && card.cardData.data.character_book && (
              <LorebookSection characterBook={card.cardData.data.character_book} />
            )}

            {activeSection === 'assets' && hasAssets && (
              <AssetsSection assets={v3Assets} savedAssets={card.savedAssets} />
            )}

            {activeSection === 'comments' && (
              <CommentsSection cardId={card.id} commentsCount={card.commentsCount} />
            )}
          </div>
        )}

        {/* Uploader Info */}
        {card.uploader && (
          <UploaderInfo uploader={card.uploader} createdAt={card.createdAt} />
        )}
      </div>
      </div>
    </AppShell>
  );
}
