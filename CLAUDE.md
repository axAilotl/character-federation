# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CardsHub is a platform for sharing, discovering, and managing AI character cards (CCv2/CCv3 format). It's a clone of Wyvern.chat's explore functionality built with Next.js 15.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: SQLite via AsyncDb abstraction layer
  - Local: better-sqlite3 with WAL mode (wrapped in async interface)
  - Production: Cloudflare D1 (native async)
- **ORM**: Drizzle ORM schema definitions in `src/lib/db/schema.ts`
- **Validation**: Zod schemas in `src/lib/validations/` for all API inputs
- **Logging**: Winston (Node.js) / Console (Cloudflare Workers) with structured output
- **Rate Limiting**: Sliding window algorithm with per-endpoint configs in `src/lib/rate-limit.ts`
- **Testing**: Vitest with 185 tests (7 test files) covering validation schemas, rate limiting, and utilities
- **Tokenizer**: tiktoken (cl100k_base encoding for GPT-4 compatible counts)
- **Styling**: Tailwind CSS v4 with CSS-in-JS theme configuration
- **Storage**: Abstracted with URL schemes (`file://`, `r2://`, future: `s3://`, `ipfs://`)
- **Runtime**: Node.js 22 (local), Cloudflare Workers (production)
- **Auth**: Cookie-based sessions with bcryptjs password hashing (work factor 12)

## Commands

```bash
# Development
npm run dev          # Start development server
npm run build        # Production build (Node.js)
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run vitest (watch mode)
npm run test:run     # Run vitest (single run)

# Cloudflare Deployment
npm run cf:build     # Build for Cloudflare Workers
npm run cf:deploy    # Deploy to Cloudflare
npm run cf:dev       # Local Cloudflare dev server

# Database
npm run db:reset     # Reset and seed database
npm run admin:reset-pw <user> <pass>  # Reset user password
```

## Architecture

### Core Domain Model

```
┌──────────────────┐         ┌─────────────────────┐
│      Card        │ 1:N     │    CardVersion      │
│   (identity)     │────────→│ (immutable snapshot)│
├──────────────────┤         ├─────────────────────┤
│ id, slug         │         │ id                  │
│ uploader_id      │         │ card_id             │
│ name, description│         │ parent_version_id   │ ← previous edit
│ visibility       │         │ forked_from_id      │ ← derivative source
│ head_version_id ─┼────────→│ storage_url         │
│ stats (denorm)   │         │ content_hash        │
└──────────────────┘         │ token counts        │
                             │ metadata flags      │
                             └─────────────────────┘
```

**Key Concepts:**
1. **Card** = logical identity (stable URL, ownership, stats)
2. **CardVersion** = immutable snapshot (content, tokens, metadata)
3. **Storage** = abstracted blob store (file:// local, r2:// production)

### Directory Structure
```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── api/cards/          # Card CRUD, download, vote, favorite, comment, visibility endpoints
│   ├── api/auth/           # Login, logout, register, session, Discord OAuth
│   ├── api/admin/          # Admin-only endpoints (stats, cards, reports, users)
│   ├── api/users/          # User profiles, favorites, tag preferences, follows
│   ├── api/feed/           # Personalized feed endpoint
│   ├── api/search/         # Full-text search endpoint
│   ├── api/tags/           # Tags listing (cached 60s)
│   ├── api/uploads/        # Static file serving with visibility enforcement
│   ├── admin/              # Admin panel pages (dashboard, cards, reports, users)
│   ├── explore/            # Main grid view with filtering
│   ├── feed/               # Personalized feed page
│   ├── card/[slug]/        # Card detail page
│   ├── user/[username]/    # User profile page
│   ├── upload/             # Card upload page (with visibility selector)
│   ├── login/              # Login/register page
│   └── settings/           # User settings page (with tag preferences)
├── components/
│   ├── ui/                 # Base components (Button, Input, Modal, Badge)
│   ├── layout/             # AppShell, Header, Sidebar
│   └── cards/              # CardGrid, CardItem, CardFilters, CardModal
├── lib/
│   ├── auth/               # Authentication (bcrypt, sessions, context)
│   ├── db/                 # Database abstraction layer
│   │   ├── schema.ts       # Drizzle ORM schema definitions
│   │   ├── driver.ts       # Dual-mode database driver
│   │   ├── async-db.ts     # Unified AsyncDb interface
│   │   ├── cards.ts        # Card operations (all async)
│   │   └── index.ts        # Database initialization
│   ├── storage/            # Storage abstraction
│   │   ├── index.ts        # Driver registry
│   │   ├── file.ts         # Local filesystem driver
│   │   └── r2.ts           # Cloudflare R2 driver
│   ├── card-architect/     # Multi-format card parsing (PNG, JSON, CharX, Voxta)
│   ├── card-parser/        # Token counting and metadata extraction
│   ├── image/              # Thumbnail generation
│   ├── validations/        # Zod schemas for API input validation
│   │   └── __tests__/      # Validation test files
│   ├── __tests__/          # Core lib test files (rate-limit, etc.)
│   ├── logger.ts           # Winston logging infrastructure
│   ├── rate-limit.ts       # Sliding window rate limiter with endpoint configs
│   └── utils/              # cn(), generateSlug(), generateId()
└── types/                  # TypeScript interfaces for cards, users, API
```

### Database Abstraction Layer

The project uses a unified async interface that works with both better-sqlite3 (local) and Cloudflare D1 (production):

```typescript
// src/lib/db/async-db.ts
interface AsyncDb {
  prepare(sql: string): AsyncStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

// Unified getter - automatically uses D1 on Cloudflare, better-sqlite3 locally
import { getDatabase } from '@/lib/db/async-db';

const db = await getDatabase();
const cards = await db.prepare('SELECT * FROM cards').all();

// Usage in cards.ts - all functions are async
export async function getCards(filters): Promise<PaginatedResponse<CardListItem>>
export async function getCardBySlug(slug): Promise<CardDetail | null>
export async function createCard(input): Promise<{ cardId, versionId }>
```

**Important:** D1 does NOT support true transactions. The `transaction()` wrapper simply executes the callback - operations are NOT atomic. Use `db.batch()` for atomic writes when needed.

### Color System - Bisexual Dark Mode (CSS Variables)
```css
--deep-space: #141414;    /* Primary background - dark */
--cosmic-teal: #1a1a1a;   /* Secondary background - slightly lighter */
--starlight: #F8FAFC;     /* Primary text - light */
--nebula: #5014a0;        /* Primary accent - bisexual purple */
--aurora: #7814a0;        /* Secondary accent - lighter purple */
--solar: #6428a0;         /* Warnings - muted purple */
--purple-deep: #3c14a0;   /* Deeper purple variant */
--purple-mid: #6414a0;    /* Mid purple variant */
```

### Visibility States
```
public      → visible to everyone
private     → owner only (and admins), not in browse/search/feed
nsfw_only   → visible only with NSFW filter enabled
unlisted    → direct link only, not in search/browse/feed
blocked     → admin removed, only admins see
```

### Character Card Parsing
The `lib/card-architect/` module handles:
- PNG tEXt chunk extraction (base64-encoded JSON in "chara" field)
- CCv2 spec parsing (`chara_card_v2`)
- CCv3 spec parsing (`chara_card_v3`) with assets support
- CharX package extraction (.charx ZIP files with card.json + assets/)
- Voxta package extraction (.voxpkg ZIP files)
- Token counting using tiktoken
- Metadata detection (alt greetings, lorebook, embedded images)
- Handles malformed JSON with trailing garbage data
- Binary asset extraction with `parseFromBufferWithAssets()`

### Storage Abstraction
The `lib/storage/` module provides:
- URL-based storage references (`file:///path`, `r2://bucket/key`, future: `s3://`, `ipfs://`)
- Pluggable driver architecture
- Content hashing for deduplication
- Drivers: `FileStorageDriver` (local), `R2StorageDriver` (Cloudflare)

### Asset Storage
- Extracted assets saved to `uploads/assets/{cardId}/`
- Thumbnails auto-generated for image assets (300px WebP)
- Asset metadata stored in `saved_assets` JSON column on card_versions
- Supports images, audio, and custom asset types
- Max upload size: 50MB (Cloudflare limit)
- Parallel batch uploads (20 concurrent) for fast processing
- For PNGs with embedded icons: uses small iconx (~30-50KB) instead of full container (avoids CF 10MB limit)

### Download Formats
The `/api/cards/[slug]/download` endpoint supports three formats:
- `png` - Card embedded in PNG image (default)
- `json` - Raw card JSON data
- `original` - Original source file (.charx, .voxpkg, .png, .json)

CharX and Voxta packages show a format-specific download button that serves the original package file.

### Tag System
- Tags are extracted directly from the card's embedded tags field
- Tags are created automatically if they don't exist in the database
- Tag slugs are normalized (lowercase, hyphenated)
- Original tag names are preserved for display
- Tag endpoint cached for 60 seconds

### Database Schema
SQLite database (`cardshub.db`) with tables:
- `cards` - Card identity with stats, visibility, head_version_id pointer
- `card_versions` - Immutable version snapshots with token counts, storage_url, content_hash
- `tags` - Tag definitions with categories and usage counts
- `card_tags` - Many-to-many relationship
- `users` - User accounts with bcrypt password hashes, admin flag, bio, profile_css
- `sessions` - Cookie-based session storage (30-day expiry)
- `votes`, `favorites`, `comments`, `downloads` - User interactions
- `reports` - Moderation reports
- `cards_fts` - FTS5 virtual table for full-text search
- `uploads` - Upload metadata for visibility enforcement
- `tag_preferences` - User tag follow/block preferences (v1.1)
- `user_follows` - Social following relationships (v1.1)

### API Endpoints

**Cards**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/cards | No | List cards (paginated, filtered by tags, sorted) |
| POST | /api/cards | Yes | Upload new card (PNG/JSON/CharX/Voxta) |
| GET | /api/cards/[slug] | No | Get single card with head version |
| DELETE | /api/cards/[slug] | Admin | Delete card |
| GET | /api/cards/[slug]/download | No | Download card (format: png, json, original) |
| GET | /api/cards/[slug]/versions | No | Get version history |
| POST | /api/cards/[slug]/vote | Yes | Vote on card (1 or -1) |
| DELETE | /api/cards/[slug]/vote | Yes | Remove vote |
| POST | /api/cards/[slug]/favorite | Yes | Toggle favorite |
| GET | /api/cards/[slug]/favorite | No | Check if favorited |
| GET | /api/cards/[slug]/comments | No | Get comments |
| POST | /api/cards/[slug]/comments | Yes | Add comment |
| POST | /api/cards/[slug]/report | Yes | Report card for moderation |
| PUT | /api/cards/[slug]/visibility | Yes | Update visibility (owner: public/private/unlisted) |

**Search & Tags**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/search | No | Full-text search with BM25 ranking and snippets |
| GET | /api/tags | No | List all tags grouped by category (cached 60s) |

**Users**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/users/[username] | No | Get public user profile (includes bio, profileCss, followers/following counts) |
| GET | /api/users/[username]/cards | No | Get cards uploaded by user |
| GET | /api/users/[username]/favorites | No | Get user's favorited cards |
| GET | /api/users/[username]/follow | Yes | Check if current user follows target user |
| POST | /api/users/[username]/follow | Yes | Follow a user |
| DELETE | /api/users/[username]/follow | Yes | Unfollow a user |
| GET | /api/users/me | Yes | Get current user's profile |
| PUT | /api/users/me | Yes | Update profile (displayName, email, bio, profileCss) |
| GET | /api/users/me/tags | Yes | Get user's tag preferences (followed/blocked) |
| PUT | /api/users/me/tags | Yes | Update single tag preference |
| POST | /api/users/me/tags | Yes | Bulk update tag preferences |

**Feed**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/feed | No | Personalized feed (followed users + tags + trending, blocked tag filtering) |

**Auth**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | No | Register new user account |
| POST | /api/auth/login | No | Login with username/password (rate limited) |
| POST | /api/auth/logout | Yes | Logout and clear session |
| GET | /api/auth/session | No | Get current session |
| GET | /api/auth/discord | No | Start Discord OAuth flow |
| GET | /api/auth/discord/callback | No | Discord OAuth callback |

**Admin (requires admin role)**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/admin/stats | Dashboard statistics |
| GET | /api/admin/cards | Paginated cards with filters |
| DELETE | /api/admin/cards/[cardId] | Delete card |
| PUT | /api/admin/cards/[cardId]/visibility | Update visibility |
| PUT | /api/admin/cards/[cardId]/moderation | Update moderation state |
| PUT | /api/admin/cards/bulk | Bulk update cards |
| GET | /api/admin/reports | Paginated reports |
| PUT | /api/admin/reports/[reportId] | Update report status |
| GET | /api/admin/users | Paginated users |
| DELETE | /api/admin/users/[userId] | Delete user |
| PUT | /api/admin/users/[userId]/admin | Toggle admin status |
| POST | /api/admin/password | Reset user password (admin only) |

### Authentication
- User registration: POST `/api/auth/register` with username (3-20 chars, alphanumeric + underscore/hyphen) and password (min 6 chars)
- Sessions stored in SQLite with 30-day expiry
- Passwords hashed with bcryptjs (work factor 12)
- Legacy SHA-256 hashes supported for migration (auto-detected by hash length)
- Admin users can delete any card and manage users
- Auth context available via `useAuth()` hook
- Bootstrap admin: Set `ALLOW_AUTO_ADMIN=true` and `ADMIN_BOOTSTRAP_PASSWORD=<pass>` env vars
- Discord OAuth: Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` env vars

### Key Patterns
- **Async Database**: All database operations use `await` - functions return `Promise<T>`
- **Zod Validation**: All API inputs validated via `parseBody()`/`parseQuery()` helpers
- Client components use `'use client'` directive with `useSearchParams` wrapped in Suspense
- API routes use async params: `{ params }: { params: Promise<{ slug: string }> }`
- Images served via API route that reads from `uploads/` directory
- Creator notes support both HTML and markdown images
- Uploads create both Card and CardVersion records atomically
- Runtime checks: `isCloudflareRuntime()` to disable fs operations on Workers
- Cache headers: Cards list (60s), individual cards (300s), tags (60s)

### Input Validation (Zod)
All API routes use Zod schemas from `src/lib/validations/` for request validation:
- `auth.ts` - Login, register, password schemas
- `cards.ts` - Card filters, upload metadata, file validation
- `interactions.ts` - Vote, comment, report schemas
- `admin.ts` - Admin operations (visibility, moderation, bulk updates)
- `common.ts` - Shared schemas (pagination, visibility, tags)

Usage pattern in API routes:
```typescript
import { parseBody, parseQuery, VoteSchema, CardFiltersSchema } from '@/lib/validations';

// POST body validation
const parsed = await parseBody(request, VoteSchema);
if ('error' in parsed) return parsed.error;
const { vote } = parsed.data;

// GET query validation
const parsed = parseQuery(request.nextUrl.searchParams, CardFiltersSchema);
if ('error' in parsed) return parsed.error;
```

### Rate Limiting
Sliding window algorithm in `src/lib/rate-limit.ts`:
- Per-endpoint configurations in `RATE_LIMITS` constant
- Predefined limits: login (10/min), register (5/10min), api (100/min), upload (10/min)
- `applyRateLimit(clientId, endpoint)` for consistent usage
- `getClientId(request)` extracts IP from CF-Connecting-IP > X-Forwarded-For > X-Real-IP
- Cleanup interval removes expired buckets every 5 minutes

```typescript
import { applyRateLimit, getClientId } from '@/lib/rate-limit';

const clientId = getClientId(request);
const rl = applyRateLimit(clientId, 'login');
if (!rl.allowed) {
  return NextResponse.json({ error: 'Rate limited' }, {
    status: 429,
    headers: { 'Retry-After': rl.retryAfter?.toString() || '60' }
  });
}
```

### Logging
Structured logging in `src/lib/logger.ts`:
- **Node.js**: Winston with colorized console (dev) or JSON format with file rotation (prod)
- **Cloudflare Workers**: Simple console logger (Winston not compatible with Workers runtime)
- Log levels: error, warn, info, debug
- Environment variables: `LOG_LEVEL` (default: info in prod, debug in dev)

```typescript
import { logAuthEvent, logError, logRateLimit } from '@/lib/logger';

logAuthEvent('login', userId, { username, ip: clientId });
logAuthEvent('login_failed', undefined, { username, ip: clientId });
logError({ path: '/api/auth/login' }, error);
logRateLimit(clientId, 'login', rl.allowed, rl.remaining);
```

### Full-Text Search (FTS5)
- Uses SQLite FTS5 virtual table `cards_fts` for fast search
- Indexes: name, description, creator, creator_notes
- Porter stemming + unicode61 tokenizer with diacritic removal
- BM25 ranking with configurable weights (name:10, description:5, creator:2, notes:1)
- Prefix matching for autocomplete (`"word"*`)
- Snippet generation with `<mark>` highlighting
- Auto-populated on startup, updated on card create/delete
- Fallback to LIKE search on Cloudflare D1 (FTS5 not supported)

### Admin Panel
- `/admin` - Dashboard with stats (cards, users, downloads, pending reports)
- `/admin/cards` - Cards management with visibility/moderation controls, bulk actions
- `/admin/reports` - Reports queue with status management
- `/admin/users` - User management with admin toggle

### Cloudflare Deployment
- Uses OpenNextJS adapter (`@opennextjs/cloudflare`)
- D1 database binding for SQLite
- R2 bucket binding for file storage
- IMAGES binding for image transformations
- Config in `wrangler.toml`
- Build: `npm run cf:build` then `npm run cf:deploy`

### Cloudflare Images Binding
Thumbnails use the IMAGES binding for on-the-fly WebP transformation:

```typescript
// src/lib/cloudflare/env.ts
export async function getImages(): Promise<ImagesBinding | null>

// Usage in /api/thumb/[...path]/route.ts
const images = await getImages();
const transformed = await images
  .input(imageData)
  .transform({ width: 500, height: 750, fit: 'cover' })
  .output({ format: 'image/webp', quality: 80 });
return transformed.response();
```

**IMPORTANT**: Image Transformations must be enabled in the Cloudflare Dashboard:
1. Go to: https://dash.cloudflare.com/?to=/:account/images/transformations
2. Select zone → Click "Enable for zone"

Without this, thumbnails fall back to serving original PNGs.

## Known Limitations

1. **D1 Transactions**: Not atomic - use `db.batch()` for critical multi-statement operations
2. **FTS5 on D1**: Not supported - falls back to LIKE queries
3. **Rate Limiting**: In-memory only, doesn't persist across Workers - use Cloudflare KV for production
4. **Thumbnails on CF**: Requires Image Transformations enabled in dashboard; falls back to original if disabled
5. **Logging on CF**: Winston not available - uses simple console logger on Workers
