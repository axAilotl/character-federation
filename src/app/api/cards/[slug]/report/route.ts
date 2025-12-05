import { NextRequest, NextResponse } from 'next/server';
import { getAsyncDb } from '@/lib/db/async-db';
import { reportCard } from '@/lib/db/cards';
import { getSession } from '@/lib/auth';
import { parseBody, ReportSchema } from '@/lib/validations';

/**
 * POST /api/cards/[slug]/report
 * Report a card for moderation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Check authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const parsed = await parseBody(request, ReportSchema);
    if ('error' in parsed) return parsed.error;
    const { reason, details } = parsed.data;

    // Get card ID from slug
    const db = getAsyncDb();
    const card = await db.prepare('SELECT id FROM cards WHERE slug = ?').get<{ id: string }>(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    // Check if user already reported this card
    const existingReport = await db.prepare(`
      SELECT id FROM reports
      WHERE card_id = ? AND reporter_id = ? AND status = 'pending'
    `).get(card.id, session.user.id);

    if (existingReport) {
      return NextResponse.json(
        { error: 'You have already reported this card' },
        { status: 400 }
      );
    }

    // Create report
    await reportCard(card.id, session.user.id, reason, details);

    return NextResponse.json({
      success: true,
      message: 'Report submitted successfully',
    });
  } catch (error) {
    console.error('Error reporting card:', error);
    return NextResponse.json(
      { error: 'Failed to report card' },
      { status: 500 }
    );
  }
}
