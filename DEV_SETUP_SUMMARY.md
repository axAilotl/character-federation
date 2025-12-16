# Dev Environment Setup - Complete ✅

## What Was Created

### Cloudflare Resources (Dev Environment)
- ✅ **D1 Database**: `cardshub-db-dev` (ID: `51735f7f-e7eb-43ed-8e4c-663d18ae529b`)
- ✅ **R2 Bucket**: `cardshub-uploads-dev`
- ✅ **KV Namespace**: `dev-CACHE_KV` (ID: `996ed4fd34f54915a8626b0a0589babd`)
- ✅ **Worker Config**: `cardshub-dev` in `wrangler.toml`

### Git Branches
- ✅ **dev branch**: Created and pushed to GitHub
- ✅ **main branch**: Updated with deployment workflows

### GitHub Actions Workflows
- ✅ **ci.yml**: Runs lint, tests, E2E on all PRs to dev/master
- ✅ **deploy-dev.yml**: Auto-deploys to dev.hub.axailotl.ai on push to dev
- ✅ **deploy-production.yml**: Auto-deploys to hub.axailotl.ai on push to master

### NPM Scripts
- ✅ `npm run cf:deploy:dev` - Deploy to dev environment
- ✅ `npm run cf:deploy` - Deploy to production (master)

### Documentation
- ✅ **DEPLOYMENT.md**: Complete workflow guide

## Next Steps (Manual Setup Required)

### 1. Configure GitHub Secrets

Go to: `https://github.com/axAilotl/character-federation/settings/secrets/actions`

Add these secrets:
```
CLOUDFLARE_API_TOKEN       - Get from Cloudflare dashboard
CLOUDFLARE_ACCOUNT_ID      - Your Cloudflare account ID
```

**To get CLOUDFLARE_API_TOKEN:**
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Add permissions:
   - Account > Workers Scripts > Edit
   - Account > D1 > Edit
   - Account > Workers R2 Storage > Edit
5. Copy the token and add to GitHub secrets

### 2. Set Up Branch Protection

#### For `master` branch:
1. Go to: `https://github.com/axAilotl/character-federation/settings/branches`
2. Click "Add rule" or edit existing rule
3. Branch name pattern: `master`
4. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
     - Required checks: `lint-and-test`, `e2e-tests`
   - ✅ Require approvals: 1
   - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Do not allow bypassing the above settings

#### For `dev` branch:
1. Click "Add rule"
2. Branch name pattern: `dev`
3. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
     - Required checks: `lint-and-test`, `e2e-tests`
   - ❌ Require approvals: 0 (faster iteration)
   - ❌ Do not allow bypassing the above settings

### 3. Configure Cloudflare Custom Domain (Optional)

To use `dev.hub.axailotl.ai`:

1. Go to Cloudflare dashboard → Workers & Pages
2. Select `cardshub-dev` worker
3. Click "Triggers" tab
4. Under "Custom Domains", add: `dev.hub.axailotl.ai`
5. DNS will be configured automatically

### 4. Set Cloudflare Secrets (Dev Environment)

```bash
# Discord OAuth (if used)
npx wrangler secret put DISCORD_CLIENT_SECRET --env dev

# R2 presigned URLs (if used)
npx wrangler secret put R2_ACCESS_KEY_ID --env dev
npx wrangler secret put R2_SECRET_ACCESS_KEY --env dev
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --env dev
```

### 5. Initialize Dev Database Schema

The dev database currently only has settings tables. To initialize the full schema:

**Option A: Import from production (recommended)**
```bash
# Export from production
npx wrangler d1 export cardshub-db --remote --output=prod-dump.sql

# Import to dev
npx wrangler d1 execute cardshub-db-dev --remote --file=prod-dump.sql
```

**Option B: Run schema file in chunks**
Break `src/lib/db/schema.sql` into smaller files and run:
```bash
npx wrangler d1 execute cardshub-db-dev --remote --file=schema-part1.sql
npx wrangler d1 execute cardshub-db-dev --remote --file=schema-part2.sql
# etc...
```

## Workflow Summary

```
feature/my-feature → dev → master
                     ↓       ↓
              dev.hub... hub.axailotl.ai
```

1. Create feature branch from `dev`
2. Make changes, commit, push
3. Create PR to `dev`
4. CI runs automatically
5. Merge to `dev` → auto-deploys to dev environment
6. Test on dev.hub.axailotl.ai
7. Create PR from `dev` to `master`
8. Get approval + CI passes
9. Merge to `master` → auto-deploys to production

## Testing the Setup

### Test dev deployment:
```bash
git checkout dev
# Make a small change (e.g., update DEPLOYMENT.md)
git add .
git commit -m "test: verify dev deployment"
git push origin dev
# Watch GitHub Actions run at:
# https://github.com/axAilotl/character-federation/actions
```

### Test production deployment:
```bash
git checkout master
git merge dev
git push origin master
# Watch deployment at GitHub Actions
```

## Verification Checklist

- [ ] GitHub secrets configured (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
- [ ] Branch protection enabled for `master` (requires approval)
- [ ] Branch protection enabled for `dev` (no approval required)
- [ ] Custom domain `dev.hub.axailotl.ai` configured
- [ ] Cloudflare secrets set for dev environment
- [ ] Dev database schema initialized
- [ ] Test deployment to dev works
- [ ] Test deployment to production works

## Troubleshooting

### Deployment fails with "authentication error"
- Check GitHub secrets are set correctly
- Verify CLOUDFLARE_API_TOKEN has required permissions

### Database errors on dev
- Make sure schema is initialized: see step 5 above
- Check database ID in wrangler.toml matches actual database

### Worker not found
- Verify you're deploying to correct environment (`--env dev` flag)
- Check worker name in wrangler.toml matches Cloudflare dashboard

## Resources

- **Production**: https://hub.axailotl.ai
- **Dev**: https://dev.hub.axailotl.ai (after domain setup)
- **GitHub Actions**: https://github.com/axAilotl/character-federation/actions
- **Cloudflare Dashboard**: https://dash.cloudflare.com/

---

**Status**: Dev environment created ✅
**Next**: Complete manual setup steps above 👆
