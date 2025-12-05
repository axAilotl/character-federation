# CardsHub

A platform for sharing, discovering, and managing AI character cards (CCv2/CCv3 format). Built with Next.js 15 and deployable to Cloudflare Workers.

## Features

- **Character Card Support**: PNG, JSON, CharX (.charx), and Voxta (.voxpkg) formats
- **Full-Text Search**: FTS5-powered search with BM25 ranking
- **User Accounts**: Local auth + Discord OAuth
- **Card Management**: Upload, vote, favorite, comment, report
- **Admin Panel**: Moderation tools, user management, stats dashboard
- **NSFW Filtering**: Visibility controls for content filtering

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: SQLite (better-sqlite3 local, Cloudflare D1 production)
- **Storage**: Local filesystem or Cloudflare R2
- **Styling**: Tailwind CSS v4
- **Validation**: Zod schemas
- **Auth**: bcryptjs + cookie sessions

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm run test:run

# Build for production
npm run build
```

## Cloudflare Deployment

```bash
# Create D1 database
npx wrangler d1 create cardshub-db

# Update wrangler.toml with database_id

# Initialize schema
npx wrangler d1 execute cardshub-db --remote --file=src/lib/db/schema.sql

# Set secrets
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET

# Deploy
npm run cf:build && npm run cf:deploy
```

## Environment Variables

```env
# Database (local only)
DATABASE_PATH=./cardshub.db

# Discord OAuth
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret

# App URL
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Admin bootstrap (development only)
ALLOW_AUTO_ADMIN=true
ADMIN_BOOTSTRAP_PASSWORD=your_password
```

## License

MIT
