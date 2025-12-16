# Deployment Guide

This project uses a dev/master branch workflow with automatic deployments to Cloudflare Workers.

## Branch Structure

```
feature/* → dev → master
            ↓       ↓
          @dev   @production
```

- **feature/*** - Feature branches for development
- **dev** - Development/staging environment
- **master** - Production environment

## Environments

### Development (dev branch)
- **URL**: https://dev.hub.axailotl.ai
- **Worker**: cardshub-dev
- **D1 Database**: cardshub-db-dev
- **R2 Bucket**: cardshub-uploads-dev
- **KV Namespace**: dev-CACHE_KV
- **Auto-deploys**: On push to `dev` branch

### Production (master branch)
- **URL**: https://hub.axailotl.ai
- **Worker**: cardshub
- **D1 Database**: cardshub-db
- **R2 Bucket**: cardshub-uploads
- **KV Namespace**: CACHE_KV
- **Auto-deploys**: On push to `master` branch

## Workflow

1. **Create a feature branch from dev**
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/my-feature
   ```

2. **Develop and commit**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Push and create PR to dev**
   ```bash
   git push origin feature/my-feature
   # Create PR on GitHub: feature/my-feature → dev
   ```

4. **CI checks run**
   - ESLint
   - Unit tests
   - E2E tests
   - Build verification

5. **Merge to dev**
   - After CI passes and review (optional for dev)
   - Automatically deploys to dev.hub.axailotl.ai

6. **Test on dev environment**
   - Verify the feature works in production-like environment
   - Check for any issues

7. **Create PR from dev to master**
   ```bash
   # Create PR on GitHub: dev → master
   ```

8. **Merge to master**
   - Requires CI to pass
   - Requires 1 approval (recommended)
   - Automatically deploys to hub.axailotl.ai

## Manual Deployment

### Deploy to dev
```bash
npm run cf:build
npm run cf:deploy:dev
```

### Deploy to production
```bash
npm run cf:build
npm run cf:deploy
```

## Database Migrations

### Dev environment
```bash
# Run migration on dev database
npx wrangler d1 execute cardshub-db-dev --remote --env dev --command "ALTER TABLE ..."
```

### Production environment
```bash
# Run migration on production database
npx wrangler d1 execute cardshub-db --remote --command "ALTER TABLE ..."
```

## GitHub Secrets Required

Set these in GitHub repository settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` - API token with Workers and D1 permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

## Branch Protection (Recommended)

### master branch
- ✅ Require pull request before merging
- ✅ Require status checks to pass (CI)
- ✅ Require 1 approval
- ✅ Dismiss stale reviews
- ❌ No direct pushes

### dev branch
- ✅ Require pull request before merging
- ✅ Require status checks to pass (CI)
- ❌ No approval required (faster iteration)
- ❌ No direct pushes

## Setting Up a New Environment

If you need to create additional environments (staging, preview, etc.):

1. Create D1 database
   ```bash
   npx wrangler d1 create cardshub-db-{env}
   ```

2. Create R2 bucket
   ```bash
   npx wrangler r2 bucket create cardshub-uploads-{env}
   ```

3. Create KV namespace
   ```bash
   npx wrangler kv namespace create CACHE_KV --env {env}
   ```

4. Add environment config to `wrangler.toml`

5. Initialize database
   ```bash
   npx wrangler d1 execute cardshub-db-{env} --remote --env {env} --file=src/lib/db/schema.sql
   ```

## Troubleshooting

### Deploy fails with "database not found"
- Check `wrangler.toml` has correct database_id for the environment
- Verify the database exists: `npx wrangler d1 list`

### Deploy fails with "bucket not found"
- Check `wrangler.toml` has correct bucket_name
- Verify the bucket exists: `npx wrangler r2 bucket list`

### Changes not visible after deploy
- Check which environment you deployed to
- Clear browser cache
- Check Cloudflare Workers logs: `npx wrangler tail --env {env}`
