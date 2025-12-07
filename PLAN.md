# PLAN.md

## Project Goals

**End Goal:** Federated platform that can run on multiple hosting providers or be self-hosted.

**Design Principles:**
- Platform-agnostic abstractions (storage, database, rate limiting)
- Cloudflare is current demo platform, not a hard dependency
- All external services should have pluggable drivers

## Completed Features

### Core Functionality
- [x] Card upload (PNG, JSON, CharX, Voxta formats)
- [x] Card detail pages with full metadata display
- [x] Card download (PNG, JSON, and original formats)
- [x] Explore page with card grid
- [x] Card modal preview on grid
- [x] Thumbnail generation for cards
- [x] Card/CardVersion schema (identity vs immutable snapshots)
- [x] Storage abstraction layer (file://, r2://)

### Card Parsing
- [x] CCv2 spec parsing
- [x] CCv3 spec parsing with assets
- [x] PNG tEXt chunk extraction
- [x] Token counting (tiktoken cl100k_base)
- [x] Embedded image detection
- [x] Alternate greetings detection
- [x] Lorebook detection
- [x] Handle malformed JSON with trailing garbage
- [x] CharX package support (.charx ZIP with card.json + assets)
- [x] Voxta package support (.voxpkg ZIP format)
- [x] Binary asset extraction from packages
- [x] Asset storage to uploads/assets/{cardId}/
- [x] Parallel batch asset uploads (20 concurrent)
- [x] Optimized main image selection (iconx for large PNGs)

### Tag System
- [x] Tags extracted directly from card data
- [x] Dynamic tag creation (new tags auto-created)
- [x] Tag slug normalization (case-insensitive)
- [x] Include/exclude tag filtering
- [x] Tag dropdown with portal rendering (z-index fix)
- [x] Tag endpoint caching (60s TTL)

### Search & Filtering
- [x] Full-text search with FTS5 (name, description, creator, notes)
- [x] BM25 ranking with configurable weights
- [x] Prefix matching for autocomplete
- [x] Snippet generation with highlighting
- [x] Tag filtering (include/exclude)
- [x] Sort options (newest, oldest, trending, popular, downloads, favorites)
- [x] Token range filtering
- [x] Feature filters (alt greetings, lorebook, embedded images)
- [x] Visibility filtering (public, nsfw_only, unlisted, blocked)
- [x] LIKE fallback for Cloudflare D1 (no FTS5 support)

### User Interactions
- [x] Voting system (upvote/downvote with user tracking)
- [x] Favorites (save cards to user profile)
- [x] Comments on cards (with threading support)
- [x] Card reporting for moderation

### Authentication
- [x] Username/password login
- [x] User registration (public signups)
- [x] Session-based auth (SQLite storage, 30-day expiry)
- [x] Auth context provider
- [x] bcryptjs password hashing (work factor 12)
- [x] Legacy SHA-256 hash support for migration
- [x] Rate limiting on login (10 attempts/60s per IP)
- [x] Admin password reset endpoint
- [x] Discord OAuth (partial - routes exist)
- [x] Conditional admin bootstrap via env vars

### User Profiles
- [x] Public profile pages (/user/[username])
- [x] User stats (cards, downloads, upvotes, favorites)
- [x] Cards tab (uploaded cards)
- [x] Favorites tab
- [x] Profile editing (display name, email)
- [x] Link to uploader on card items
- [x] User bio with 2000 char limit (v1.1)
- [x] Custom profile CSS with sanitization (v1.1)
- [x] Followers/following counts (v1.1)
- [x] Follow/unfollow button (v1.1)

### Social Features (v1.1)
- [x] Tag preferences (follow/block tags)
- [x] User following system
- [x] Personalized feed with followed users/tags
- [x] Blocked tag filtering in feed

### Admin Panel
- [x] Admin dashboard with statistics
- [x] Cards management (visibility, moderation, delete)
- [x] Bulk card operations
- [x] Reports management (pending, reviewed, resolved, dismissed)
- [x] Users management (admin toggle, delete)
- [x] Admin-only route protection
- [x] Admin password reset CLI and API

### Moderation
- [x] Visibility states (public, nsfw_only, unlisted, blocked)
- [x] Moderation states (ok, review, blocked)
- [x] Report system with reasons
- [x] Auto-flag cards with 3+ pending reports

### UI/UX
- [x] Bisexual dark mode color palette (purple accents)
- [x] Responsive grid layout
- [x] Feature badges (Greetings, Lorebook, Images) with counts
- [x] Consistent icon usage across modal and card pages
- [x] Creator notes with HTML + markdown image support
- [x] Greeting images centered at 50% size
- [x] Assets section with preview and download for packages

### Infrastructure
- [x] Async database abstraction (AsyncDb)
- [x] Dual-mode support: better-sqlite3 (local) + Cloudflare D1 (prod)
- [x] R2 storage driver for Cloudflare
- [x] Cloudflare Workers deployment via OpenNextJS
- [x] Runtime detection (isCloudflareRuntime)
- [x] Cloudflare Image Resizing for thumbnails
- [x] Upload authentication requirement
- [x] Path traversal protection on uploads
- [x] Upload visibility enforcement (public/private/unlisted)
- [x] Conditional request handling (ETag, If-Modified-Since)
- [x] Cache-Control headers on API responses

---

## Core Philosophy

**Discovery is Everything.** Users finding the right cards is THE critical feature. Every version should improve discoverability.

**No Collections.** CharX and Voxta packages already bundle characters, scenarios, lorebooks, and assets. We support these formats natively - no need for platform-level collections.

**Theming.** Dark mode only. Admin-controlled site-wide themes + user-controlled profile customization (MySpace-style CSS). No light mode.

**Federation After Admin.** Complete admin functionality before federation work.

---

## Version Roadmap

### v1.0 - MVP Polish
*Production-ready release with performance improvements*

**Done:**
- [x] Zod validation on all API inputs
- [~] Unit tests (185 tests - validation & rate limiting; parsing/db pending)
- [x] **Loading indicators** - Progress feedback for large file uploads (XMLHttpRequest with progress events)

**Remaining:**
- [ ] **CI/CD pipeline** - GitHub Actions for lint/test on PR
- [ ] **Production rate limiting** - Redis/generic KV (platform-agnostic)
- [ ] OAuth completion (Google, GitHub - Discord partial)
- [ ] Password reset flow (email-based)
- [ ] Email verification

### v1.1 - Social & Personalization ✅
*Community features and user expression*

**Completed:**
- [x] **User bio** - Bio/about section (max 2000 chars) on profile
- [x] **Profile CSS customization** - User-editable CSS (max 10000 chars) with sanitization
- [x] **Tag preferences** - Users can follow/block tags (GET/PUT/POST /api/users/me/tags)
- [x] **User follows** - Social following system (GET/POST/DELETE /api/users/[username]/follow)
- [x] **Social feed** - Personalized feed combining followed users, followed tags, and trending (/api/feed)
- [x] **Profile page updates** - Bio display, follower/following counts, follow button, custom CSS injection

**Schema additions:**
- `users.bio` (TEXT, max 2000 chars)
- `users.profile_css` (TEXT, max 10000 chars)
- `tag_preferences` table (user_id, tag_id, preference: 'follow'|'block')
- `user_follows` table (follower_id, following_id)

**Remaining for polish:**
- [ ] *CSS class documentation* - Document available classes for profile customization
- [ ] *Future: CodeMirror profile editor tool*

### v1.2 - Privacy Controls
*Enhanced card visibility options*

- [ ] **Private visibility** - Cards visible only to owner (distinct from blocked)
- [ ] **Unlisted visibility** - Cards accessible via direct link only, not in search/browse
- [ ] Visibility states: `public` | `private` | `unlisted` | `nsfw_only` | `blocked`

### v1.3 - Content Safety UX
*Better NSFW handling*

- [ ] **Global NSFW blur setting** - User preference applies to:
  - Card thumbnails in grid (current)
  - Embedded images in greetings
  - Embedded images in creator notes
- [ ] Card editing (creates new CardVersion, preserves history)
- [ ] Card forking (creates new Card with forked_from_version_id)

### v2.0 - Federation Foundation
*Multi-instance support - requires character-foundry updates first*

**Prerequisites:** Complete character-foundry federation protocol support

- [ ] ActivityPub integration at character-foundry level
- [ ] Instance identity and actor management
- [ ] Domain allowlist/blocklist
- [ ] Local-only content flags (cards that don't federate)
- [ ] Multi-instance card discovery

### v2.1 - Admin Theming
*Per-community customization*

- [ ] **Admin theme editor** - Full control over site colors and elements
- [ ] Theme presets for quick setup
- [ ] CSS variable overrides for advanced customization
- [ ] Per-community branding support

---

## Backlog (Unscheduled)
*Nice-to-have features, no timeline commitment*

- [ ] Bulk upload
- [ ] S3/IPFS storage drivers
- [ ] Structured logging with request IDs
- [ ] Error boundaries with user-friendly messages
- [ ] N+1 query optimization in user profiles
- [ ] Search autocomplete suggestions
- [ ] Notifications system (comments, follows)
- [ ] User warnings system (admin)
- [ ] IP bans (admin)
- [ ] Storage quotas per user

---

## Architecture Notes

### Domain Model
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

### Database
- SQLite via AsyncDb abstraction (async interface for both engines)
- Local: better-sqlite3 (sync ops wrapped in promises)
- Production: Cloudflare D1 (native async)
- Denormalized stats on cards table for performance
- FTS5 virtual table for full-text search (local only)
- Sessions table for auth

### File Storage
- Storage abstraction with URL schemes (file://, r2://)
- Local: `uploads/` directory
- Production: Cloudflare R2 bucket
- Thumbnails: Sharp locally, CF Image Resizing in production
- Served via API route with visibility enforcement

### Auth Flow
1. POST /api/auth/register or /api/auth/login with username/password
2. Server validates, hashes password with bcrypt, creates session in SQLite
3. Session cookie set with HttpOnly flag
4. Client fetches /api/auth/session on mount
5. AuthContext provides user state to components

### Deployment Targets
1. **Local Development**: `npm run dev` (Node.js + better-sqlite3)
2. **Node.js Production**: `npm run build && npm run start`
3. **Cloudflare Workers**: `npm run cf:build && npm run cf:deploy`

---

## Technical Debt Resolved

- [x] ~~Proper password hashing (bcrypt instead of SHA256)~~ - Done, bcryptjs with work factor 12
- [x] ~~Synchronous database operations~~ - Done, full async migration completed
- [x] ~~File operations on Cloudflare~~ - Done, runtime checks disable fs on Workers
- [x] ~~Unauthenticated uploads~~ - Done, requires session
- [x] ~~Upload path traversal~~ - Done, safeResolveUploadPath with tests

## Technical Debt Remaining

- [x] Zod validation - used for all API inputs
- [~] Test coverage - 7 test files (185 tests) covering validation and rate limiting; db/api tests pending
- [x] Loading states - Upload progress indicators with XMLHttpRequest (v1.0)
- [ ] Rate limiting persistence - in-memory only (v1.0: Redis/generic KV, keep platform-agnostic)
- [ ] Error handling - generic catch-all, no structured errors
- [ ] D1 transaction awareness - documented but not enforced
