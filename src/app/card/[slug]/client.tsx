'use client';

import { useState, useMemo, useEffect } from 'react';
import { AppShell } from '@/components/layout';
import type { CardDetail } from '@/types/card';
import {
  CardHero,
  SectionTabs,
  UploaderInfo,
  NotesSection,
  GeneralSection,
  GreetingsSection,
  LorebookSection,
  AssetsSection,
  AdvancedSection,
  CommentsSection,
  type Section,
  type CardExtensions,
} from './components';
import type { CharacterCardV3 } from '@/types/card';

interface CardDetailClientProps {
  card: CardDetail;
}

export function CardDetailClient({ card }: CardDetailClientProps) {
  const [activeSection, setActiveSection] = useState<Section>('notes');

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
    return styleMatch ? styleMatch[1] : null;
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

  // Check for extensions
  const extensions = card.cardData.data.extensions as CardExtensions | undefined;
  const hasAdvancedContent = extensions?.depth_prompt ||
                             card.cardData.data.system_prompt ||
                             card.cardData.data.post_history_instructions ||
                             card.cardData.data.mes_example;

  // Check for assets (V3 cards or saved assets from packages)
  const v3Assets = card.cardData.spec === 'chara_card_v3'
    ? (card.cardData as CharacterCardV3).data.assets
    : undefined;
  const hasSavedAssets = !!(card.savedAssets && card.savedAssets.length > 0);
  const hasV3Assets = !!(v3Assets && v3Assets.length > 0);
  const hasAssets = hasV3Assets || hasSavedAssets;

  const sections: { id: Section; label: string; available: boolean }[] = [
    { id: 'notes', label: "Creator's Notes", available: true },
    { id: 'general', label: 'General', available: true },
    { id: 'greetings', label: 'Greetings', available: card.hasAlternateGreetings || !!card.cardData.data.first_mes },
    { id: 'lorebook', label: 'Lorebook', available: card.hasLorebook },
    { id: 'assets', label: 'Assets', available: hasAssets },
    { id: 'advanced', label: 'Advanced', available: !!hasAdvancedContent },
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
      <div className="w-full">
        <div className="glass rounded-xl p-6">
          {activeSection === 'notes' && (
            <NotesSection creatorNotes={card.cardData.data.creator_notes || card.creatorNotes} isNsfw={isNsfw} />
          )}

          {activeSection === 'general' && (
            <GeneralSection cardData={card.cardData} tokens={card.tokens} />
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

          {activeSection === 'advanced' && (
            <AdvancedSection cardData={card.cardData} tokens={card.tokens} />
          )}

          {activeSection === 'comments' && (
            <CommentsSection cardId={card.id} commentsCount={card.commentsCount} />
          )}
        </div>

        {/* Uploader Info */}
        {card.uploader && (
          <UploaderInfo uploader={card.uploader} createdAt={card.createdAt} />
        )}
      </div>
    </AppShell>
  );
}
