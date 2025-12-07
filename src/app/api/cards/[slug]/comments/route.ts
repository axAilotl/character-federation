import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/async-db';
import { addComment, getComments } from '@/lib/db/cards';
import { getSession } from '@/lib/auth';
import { parseBody, CommentSchema } from '@/lib/validations';

/**
 * GET /api/cards/[slug]/comments
 * Get all comments for a card
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Get card ID from slug
    const db = await getDatabase();
    const card = await db.prepare('SELECT id FROM cards WHERE slug = ?').get<{ id: string }>(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    const comments = await getComments(card.id);

    // Organize comments into threaded structure
    const threadedComments = buildCommentTree(comments);

    return NextResponse.json({
      comments: threadedComments,
      total: comments.length,
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cards/[slug]/comments
 * Add a comment to a card
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
    const parsed = await parseBody(request, CommentSchema);
    if ('error' in parsed) return parsed.error;
    const { content, parentId } = parsed.data;

    // Get card ID from slug
    const db = await getDatabase();
    const card = await db.prepare('SELECT id FROM cards WHERE slug = ?').get<{ id: string }>(slug);

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404 }
      );
    }

    // Validate parent comment if provided
    if (parentId) {
      const parentComment = await db.prepare('SELECT id FROM comments WHERE id = ? AND card_id = ?').get(parentId, card.id);
      if (!parentComment) {
        return NextResponse.json(
          { error: 'Parent comment not found' },
          { status: 404 }
        );
      }
    }

    // Add comment (content already trimmed by schema transform)
    const commentId = await addComment(card.id, session.user.id, content, parentId ?? undefined);

    // Get user info for response
    const user = await db.prepare('SELECT username, display_name FROM users WHERE id = ?').get<{
      username: string;
      display_name: string | null;
    }>(session.user.id);

    return NextResponse.json({
      success: true,
      data: {
        id: commentId,
        userId: session.user.id,
        username: user?.username || 'Unknown',
        displayName: user?.display_name || null,
        parentId: parentId || null,
        content,
        createdAt: Math.floor(Date.now() / 1000),
      },
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json(
      { error: 'Failed to add comment' },
      { status: 500 }
    );
  }
}

// Helper to build comment tree
interface Comment {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  parentId: string | null;
  content: string;
  createdAt: number;
  replies?: Comment[];
}

function buildCommentTree(comments: Comment[]): Comment[] {
  const commentMap = new Map<string, Comment>();
  const rootComments: Comment[] = [];

  // First pass: create map of all comments with empty replies array
  for (const comment of comments) {
    commentMap.set(comment.id, { ...comment, replies: [] });
  }

  // Second pass: build tree
  for (const comment of comments) {
    const commentWithReplies = commentMap.get(comment.id)!;

    if (comment.parentId) {
      const parent = commentMap.get(comment.parentId);
      if (parent) {
        parent.replies!.push(commentWithReplies);
      } else {
        // Parent not found, treat as root
        rootComments.push(commentWithReplies);
      }
    } else {
      rootComments.push(commentWithReplies);
    }
  }

  return rootComments;
}
