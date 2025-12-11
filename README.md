# CardsHub

A platform for sharing, discovering, and managing AI character cards. Supports CCv2, CCv3, CharX, and Voxta formats.

**Live:** https://hub.axailotl.ai

## Features

- **Multi-format support** - PNG, JSON, CharX (.charx), Voxta (.voxpkg)
- **Full-text search** - FTS5-powered search with BM25 ranking
- **Tag system** - Auto-extracted from card data with include/exclude filtering
- **User interactions** - Voting, favorites, comments, reporting
- **Asset extraction** - Embedded images, audio, and custom assets from packages
- **Admin panel** - Moderation, visibility controls, user management
- **WebP thumbnails** - Cloudflare Image Transformations for optimized delivery
- **Personalized feed** - Content from followed users and tags, plus trending
- **Social features** - Follow users, follow/block tags, user profiles with bio
- **Privacy controls** - Public, private, and unlisted visibility on uploads

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Database:** SQLite (better-sqlite3 local, Cloudflare D1 production)
- **Storage:** Local filesystem / Cloudflare R2
- **Auth:** Cookie-based sessions with bcrypt
- **Validation:** Zod schemas
- **Testing:** Vitest (185 tests)
- **Styling:** Tailwind CSS v4

## Quick Start

```bash
# Install dependencies
npm install

# Initialize database
npm run db:reset

# Start dev server
npm run dev
```

## Deployment

### Cloudflare Workers

```bash
# Build and deploy
npm run cf:build && npm run cf:deploy

# Create D1 database (first time)
npm run cf:d1:create
npm run cf:d1:migrate

# Create R2 bucket (first time)
npm run cf:r2:create
```

### Environment Variables

```bash
# Local development
ALLOW_AUTO_ADMIN=true          # Enable admin bootstrap
ADMIN_BOOTSTRAP_PASSWORD=xxx   # Bootstrap password
DATABASE_PATH=./cardshub.db    # SQLite database path
GITHUB_TOKEN=ghp_xxx           # GitHub token for @character-foundry packages

# Production (Cloudflare secrets)
GITHUB_TOKEN=ghp_xxx           # Required for npm install (GitHub Packages auth)
DISCORD_CLIENT_ID=xxx          # Discord OAuth
DISCORD_CLIENT_SECRET=xxx

# Optional
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

> **Note:** The `GITHUB_TOKEN` is required to install `@character-foundry/*` packages from GitHub Packages.
> Set it as an environment variable in Cloudflare Pages/Workers settings.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Run tests (watch) |
| `npm run test:run` | Run tests (once) |
| `npm run lint` | ESLint |
| `npm run db:reset` | Reset database |
| `npm run admin:reset-pw <user> <pass>` | Reset user password |
| `npm run cf:deploy` | Deploy to Cloudflare |

## API

See [CLAUDE.md](./CLAUDE.md) for full API documentation.

### Key Endpoints

- `GET /api/cards` - List cards with filtering
- `POST /api/cards` - Upload card (auth required)
- `GET /api/cards/[slug]/download?format=png|json|original` - Download card
- `PUT /api/cards/[slug]/visibility` - Update card visibility (owner only)
- `GET /api/search?q=query` - Full-text search
- `GET /api/tags` - List tags by category
- `GET /api/feed` - Personalized feed (followed users/tags + trending)
- `GET /api/users/me/tags` - User tag preferences (follow/block)

## Troubleshooting

### Production broken after schema change
Schema changes in `schema.sql` are NOT auto-applied to D1. Run migrations manually:
```bash
npx wrangler d1 execute cardshub-db --remote --command "ALTER TABLE cards ADD COLUMN new_column TEXT"
```

### CI fails with 403 on @character-foundry packages
New packages need visibility set to `public` and linked to source repo. Go to:
https://github.com/orgs/character-foundry/packages → Package Settings → Visibility: Public + Link Repository

### API works locally but fails on Cloudflare
- Don't use generated columns in queries (use inline calculations)
- Don't use FTS5 (falls back to LIKE on D1)
- Check if schema was migrated to D1

### Push doesn't update production
Deployment is manual: `npm run cf:build && npm run cf:deploy`

## License

MIT
