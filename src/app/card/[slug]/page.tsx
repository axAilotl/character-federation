import { notFound } from 'next/navigation';
import { getCardBySlug } from '@/lib/db/cards';
import { CardDetailClient } from './client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function CardDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);

  if (!card) {
    notFound();
  }

  return <CardDetailClient card={card} />;
}

// Generate metadata for the page
export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);

  if (!card) {
    return { title: 'Card Not Found' };
  }

  return {
    title: `${card.name} - CardsHub`,
    description: card.description || `View ${card.name} character card`,
  };
}
