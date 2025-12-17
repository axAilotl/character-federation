# Upstream GitHub Issues - Draft

These issues should be filed to `character-foundry/*` repositories **BEFORE** starting the refactor work. This ensures the primitives we need exist in the packages rather than being custom code in CardsHub.

---

## Issue #1: D1-compatible SyncStateStore

**Repository:** `character-foundry/character-foundry` (federation package)
**Labels:** `enhancement`, `cloudflare`, `federation`

### Title
feat(federation): Add D1SyncStateStore for Cloudflare deployment

### Body

## Summary
Add a D1-compatible implementation of `SyncStateStore` for production federation support on Cloudflare Workers.

## Background
The current `SyncStateStore` implementations (Memory, File, LocalStorage) don't work in production Cloudflare Workers environment. CardsHub needs to store federation sync state in D1 for its Cloudflare deployment.

Reference: [CardsHub Improvement Plan](link-to-plan)

## Current Implementations
- `MemorySyncStateStore` - For testing only
- `FileSyncStateStore` - Node.js filesystem
- `createLocalStorageStore` - Browser localStorage

## Proposed Implementation

```typescript
// src/state-store.ts (addition)

export class D1SyncStateStore implements SyncStateStore {
  constructor(private db: D1Database, private tableName = 'federation_sync_state') {}

  async init(): Promise<void> {
    // Create table if not exists
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        federated_id TEXT PRIMARY KEY,
        local_id TEXT NOT NULL,
        platform_ids TEXT NOT NULL,  -- JSON
        last_sync TEXT NOT NULL,     -- JSON
        version_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        conflict TEXT,               -- JSON, nullable
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);
  }

  async get(federatedId: string): Promise<CardSyncState | null> {
    const row = await this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE federated_id = ?`
    ).bind(federatedId).first();

    if (!row) return null;
    return this.rowToState(row);
  }

  async set(state: CardSyncState): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName}
      (federated_id, local_id, platform_ids, last_sync, version_hash, status, conflict, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).bind(
      state.federatedId,
      state.localId,
      JSON.stringify(state.platformIds),
      JSON.stringify(state.lastSync),
      state.versionHash,
      state.status,
      state.conflict ? JSON.stringify(state.conflict) : null
    ).run();
  }

  async delete(federatedId: string): Promise<void> {
    await this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE federated_id = ?`
    ).bind(federatedId).run();
  }

  async list(): Promise<CardSyncState[]> {
    const { results } = await this.db.prepare(
      `SELECT * FROM ${this.tableName}`
    ).all();
    return results.map(row => this.rowToState(row));
  }

  async findByPlatformId(platform: PlatformId, platformId: string): Promise<CardSyncState | null> {
    const { results } = await this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE json_extract(platform_ids, ?) = ?`
    ).bind(`$.${platform}`, platformId).all();

    if (results.length === 0) return null;
    return this.rowToState(results[0]);
  }

  private rowToState(row: Record<string, unknown>): CardSyncState {
    return {
      federatedId: row.federated_id as string,
      localId: row.local_id as string,
      platformIds: JSON.parse(row.platform_ids as string),
      lastSync: JSON.parse(row.last_sync as string),
      versionHash: row.version_hash as string,
      status: row.status as CardSyncState['status'],
      conflict: row.conflict ? JSON.parse(row.conflict as string) : undefined,
    };
  }
}
```

## Migration Script

```sql
-- For existing CardsHub deployments
CREATE TABLE IF NOT EXISTS federation_sync_state (
  federated_id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  platform_ids TEXT NOT NULL,
  last_sync TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  conflict TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
```

## Use Cases
1. CardsHub production deployment on Cloudflare Workers
2. Any federation-enabled app using D1 as primary database
3. Self-hosted instances using SQLite (D1 is SQLite-based)

## Testing
- Unit tests with D1 mock
- Integration tests with Miniflare

## Alternatives Considered
- **KV-based store**: Considered, but sync state has complex queries (findByPlatformId) that benefit from SQL
- **Durable Objects**: More complex, overkill for this use case

---

## Issue #2: Token Counting Standardization

**Repository:** `character-foundry/character-foundry` (loader or new package)
**Labels:** `enhancement`, `api`

### Title
feat: Add standardized token counting for character cards

### Body

## Summary
Add a standardized token counting utility to ensure consistent token counts across all platforms using character-foundry packages.

## Background
CardsHub has its own token counting implementation using tiktoken. This should be standardized in the ecosystem to ensure consistent token counts between:
- CardsHub archive
- SillyTavern
- Desktop editors
- Other federation clients

Different token counts between platforms causes confusion for users.

## Current CardsHub Implementation
```typescript
// src/lib/card-parser/token-counter.ts
import { Tiktoken, getEncodingNameForModel } from 'tiktoken';

const enc = new Tiktoken(/* cl100k_base */);

export function countTokens(text: string): number {
  return enc.encode(text).length;
}

export function countCardTokens(card: CCv3Data): TokenCounts {
  return {
    description: countTokens(card.data.description || ''),
    personality: countTokens(card.data.personality || ''),
    scenario: countTokens(card.data.scenario || ''),
    // ... etc
  };
}
```

## Proposed API

### Option A: Add to loader package
```typescript
// @character-foundry/loader
export interface TokenCounts {
  description: number;
  personality: number;
  scenario: number;
  firstMes: number;
  mesExample: number;
  systemPrompt: number;
  postHistoryInstructions: number;
  alternateGreetings: number;
  lorebook: number;
  creatorNotes: number;
  total: number;
}

export interface TokenizerOptions {
  model?: 'gpt-4' | 'gpt-3.5-turbo' | 'claude';
  encoding?: 'cl100k_base' | 'p50k_base';
}

export function countCardTokens(card: CCv3Data, options?: TokenizerOptions): TokenCounts;
export function countText(text: string, options?: TokenizerOptions): number;
```

### Option B: New package `@character-foundry/tokenizer`
```typescript
// @character-foundry/tokenizer
export * from './counter';
export * from './types';

// Separate package allows optional installation
// (tiktoken is ~15MB, not everyone needs it)
```

## Considerations
- **Bundle size**: tiktoken is large (~15MB). New package allows opt-in.
- **WASM compatibility**: tiktoken has WASM version for browser/workers
- **Model differences**: Different models use different tokenizers

## Recommendation
Create `@character-foundry/tokenizer` as separate package to keep loader lightweight.

---

## Issue #3: Server-side Metadata Validation

**Repository:** `character-foundry/character-foundry` (loader package)
**Labels:** `enhancement`, `security`, `api`

### Title
feat(loader): Add server-side metadata validation for client-parsed uploads

### Body

## Summary
Add a utility function to validate client-provided metadata against actual parsed card data, supporting optimistic UI while maintaining server authority.

## Background
CardsHub supports client-side parsing for optimistic UI (user sees metadata before upload completes). However, the server must validate and recompute critical fields to prevent spoofing. Need a standardized utility for this.

## Security Context
Without validation, clients can:
- Spoof token counts (show lower than actual)
- Spoof content hashes (bypass deduplication)
- Submit disallowed tag/visibility combinations

## Proposed API

```typescript
// @character-foundry/loader

export interface ClientMetadata {
  name: string;
  description?: string;
  creator?: string;
  tokens: {
    description: number;
    personality: number;
    // ... other fields
    total: number;
  };
  contentHash: string;
  tags: string[];
  hasLorebook: boolean;
  lorebookEntriesCount: number;
  // ... other metadata
}

export interface ValidationResult {
  isValid: boolean;
  /** Whether client metadata matches computed values */
  isTrusted: boolean;
  /** Differences between client and computed */
  discrepancies: Array<{
    field: string;
    clientValue: unknown;
    computedValue: unknown;
  }>;
  /** Server-authoritative values to use */
  authoritative: {
    tokens: TokenCounts;
    contentHash: string;
    hasLorebook: boolean;
    lorebookEntriesCount: number;
  };
  /** Warnings (non-blocking) */
  warnings: string[];
  /** Errors (blocking) */
  errors: string[];
}

export interface ValidationOptions {
  /** Maximum allowed token count discrepancy (default: 0) */
  tokenTolerance?: number;
  /** Whether to allow hash mismatches (default: false) */
  allowHashMismatch?: boolean;
  /** Tag validation function */
  validateTags?: (tags: string[]) => { valid: boolean; filtered: string[]; reason?: string };
}

export function validateClientMetadata(
  clientMetadata: ClientMetadata,
  parseResult: ParseResult,
  options?: ValidationOptions
): ValidationResult;
```

## Example Usage

```typescript
const parseResult = await parseCard(fileBuffer);
const clientMeta = JSON.parse(formData.get('metadata'));

const validation = validateClientMetadata(clientMeta, parseResult, {
  tokenTolerance: 5, // Allow 5 token variance for encoding differences
  validateTags: (tags) => {
    const filtered = tags.filter(t => !BLOCKED_TAGS.includes(t));
    return {
      valid: filtered.length === tags.length,
      filtered,
      reason: filtered.length !== tags.length ? 'Some tags were blocked' : undefined
    };
  }
});

if (!validation.isValid) {
  return error(400, validation.errors.join(', '));
}

// Use authoritative values
const card = createCard({
  ...parseResult.card,
  tokens: validation.authoritative.tokens,
});
```

## Use Cases
1. CardsHub optimistic upload with server validation
2. Any upload API that accepts client-pre-parsed metadata
3. Federation inbox validation

---

## Issue #4: ImageService Abstraction

**Repository:** `character-foundry/character-foundry` (core or new package)
**Labels:** `enhancement`, `abstraction`, `cloudflare`

### Title
feat: Add ImageService abstraction for multi-environment image processing

### Body

## Summary
Create an abstraction for image processing that works across Node.js (sharp) and Cloudflare Workers (Images binding), eliminating environment-specific code in business logic.

## Background
CardsHub has ~15 instances of `isCloudflareRuntime()` checks, mostly for image processing. This:
- Forces maintaining two parallel code paths
- Causes bugs that exist in one environment but not the other
- Makes testing difficult

## Current Pattern (Anti-pattern)
```typescript
if (isCloudflareRuntime()) {
  const images = await getImages();
  const result = await images
    .input(buffer)
    .transform({ width: 300, height: 450, fit: 'cover' })
    .output({ format: 'image/webp', quality: 80 });
  return result.response();
} else {
  const sharp = await import('sharp');
  const result = await sharp(buffer)
    .resize(300, 450, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();
  return new Response(result);
}
```

## Proposed API

```typescript
// @character-foundry/core (or new @character-foundry/image)

export interface ResizeOptions {
  width: number;
  height: number;
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  background?: string;
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export interface OutputOptions {
  format: 'webp' | 'png' | 'jpeg' | 'avif';
  quality?: number;
}

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface IImageService {
  /** Resize an image */
  resize(input: BinaryData, options: ResizeOptions): Promise<BinaryData>;

  /** Convert format */
  convert(input: BinaryData, options: OutputOptions): Promise<BinaryData>;

  /** Resize and convert in one operation */
  transform(
    input: BinaryData,
    resize: ResizeOptions,
    output: OutputOptions
  ): Promise<BinaryData>;

  /** Get image metadata */
  getInfo(input: BinaryData): Promise<ImageInfo>;

  /** Generate thumbnail with preset */
  thumbnail(
    input: BinaryData,
    preset: 'card' | 'grid' | 'avatar' | 'asset'
  ): Promise<BinaryData>;
}

// Implementations
export class SharpImageService implements IImageService { ... }
export class CloudflareImageService implements IImageService { ... }

// Factory
export function createImageService(
  env: 'node' | 'cloudflare',
  options?: { cfBinding?: ImagesBinding }
): IImageService;

// Thumbnail presets
export const THUMBNAIL_PRESETS = {
  card: { width: 500, height: 750, fit: 'cover', format: 'webp', quality: 80 },
  grid: { width: 300, height: 450, fit: 'cover', format: 'webp', quality: 80 },
  avatar: { width: 128, height: 128, fit: 'cover', format: 'webp', quality: 85 },
  asset: { width: 300, height: 300, fit: 'inside', format: 'webp', quality: 80 },
};
```

## Usage After

```typescript
// src/lib/image.ts
const imageService = createImageService(
  isCloudflare() ? 'cloudflare' : 'node',
  { cfBinding: await getImages() }
);

// Business logic - no environment checks!
const thumbnail = await imageService.thumbnail(buffer, 'card');
```

## Package Location Options

### Option A: Add to `@character-foundry/core`
- Pro: Central location, no new package
- Con: Core becomes larger, sharp is big dependency

### Option B: New `@character-foundry/image` package
- Pro: Optional dependency, clean separation
- Con: Another package to maintain

**Recommendation:** Option B - New package allows sharp to be optional.

---

## Issue #5: Complete HTTP Signature Validation (Security)

**Repository:** `character-foundry/character-foundry` (federation package)
**Labels:** `security`, `federation`, `priority:high`

### Title
security(federation): Complete HTTP signature validation implementation

### Body

## Summary
Complete the HTTP signature validation implementation which is currently stubbed, blocking production federation use.

## Current State
The federation package has this warning:
```typescript
/**
 * ⚠️  WARNING: This package is experimental and incomplete.
 *
 * Security-critical features (signature validation, inbox handling) are stubbed.
 * Do NOT use in production without explicit opt-in.
 */
```

Specifically:
1. `validateActivitySignature()` returns `true` always
2. No inbox signature verification
3. No key rotation support

## Security Risk
Without proper signature validation:
- Anyone can forge activities claiming to be from any actor
- Malicious actors can inject fake cards into federation
- No way to verify message integrity

## Proposed Implementation

### 1. HTTP Signature Validation
```typescript
// Currently (stubbed)
export async function validateActivitySignature(
  activity: FederatedActivity,
  headers: Headers
): Promise<boolean> {
  return true; // STUB - DO NOT USE IN PRODUCTION
}

// Proposed
export async function validateActivitySignature(
  activity: FederatedActivity,
  headers: Headers,
  options: SignatureValidationOptions
): Promise<SignatureValidationResult> {
  const signatureHeader = headers.get('Signature');
  if (!signatureHeader) {
    return { valid: false, error: 'Missing Signature header' };
  }

  const parsedSig = parseSignatureHeader(signatureHeader);

  // Fetch actor's public key
  const actor = await fetchActor(activity.actor, options.fetchFn);
  if (!actor?.publicKey?.publicKeyPem) {
    return { valid: false, error: 'Actor has no public key' };
  }

  // Verify signature
  const isValid = await verifyHttpSignature(
    parsedSig,
    actor.publicKey.publicKeyPem,
    headers,
    options.method,
    options.path
  );

  return { valid: isValid, actor };
}
```

### 2. Signature Parsing
```typescript
interface ParsedSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

function parseSignatureHeader(header: string): ParsedSignature;
```

### 3. Signature Verification
```typescript
async function verifyHttpSignature(
  sig: ParsedSignature,
  publicKeyPem: string,
  headers: Headers,
  method: string,
  path: string
): Promise<boolean>;
```

### 4. Request Signing (for outgoing)
```typescript
export function signRequest(
  request: Request,
  privateKeyPem: string,
  keyId: string
): Request;
```

## Testing Requirements
- Unit tests for signature parsing
- Unit tests for signature verification with known-good test vectors
- Integration tests with actual key pairs
- Test vectors from other ActivityPub implementations (Mastodon, Pleroma)

## Dependencies
- `jose` or `@peculiar/webcrypto` for crypto operations
- No Node.js-only crypto (must work in Workers)

## Timeline Consideration
This is a security-critical feature. It should be:
1. Implemented carefully with security review
2. Tested against other ActivityPub implementations
3. Audited before production use

## Related
- ActivityPub HTTP Signatures spec
- Mastodon signature implementation (reference)

---

## Issue #6: Selective ZIP Extraction (Central Directory Index)

**Repository:** `character-foundry/character-foundry` (core package, or new `zip` package)
**Labels:** `enhancement`, `performance`, `api`

### Title
feat(core): Add ZIP central directory index + selective entry extraction

### Body

## Summary
Add a small ZIP utility that can index the central directory and extract *specific* entries without inflating the entire archive.

## Background
Large `.charx` / `.voxpkg` uploads can be 100–400MB and contain thousands of assets. Many apps only need:
- `.charx`: `card.json` + optional sampled preview assets
- `.voxpkg`: `Characters/*/character.json` + `Characters/*/thumbnail.*` (multi-character packages can skip assets entirely)

Streaming unzip approaches (e.g. iterating all entries) still inflate every file, which is slow and can exceed browser/Worker memory.

CardsHub currently implements a minimal reader at `src/lib/client/zip.ts` that:
- Finds the End Of Central Directory (EOCD)
- Indexes entries from the central directory
- Inflates only requested entries (method 0 stored, method 8 deflate)

## Proposed API

```ts
export type ZipEntry = {
  name: string;
  compressionMethod: number; // 0 (stored) | 8 (deflate)
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

/** Returns all central-directory entries (stable ordering left to caller). */
export function indexZip(buffer: Uint8Array): ZipEntry[];

/** Extracts a single entry using central-directory metadata. */
export function extractZipEntry(buffer: Uint8Array, entry: ZipEntry): Uint8Array;
```

## Design Constraints
- **Minimal** by default (suitable for browser + Workers)
- No ZIP64 initially (explicit error)
- No encryption support
- No archive-wide extraction (single-entry only)
- Supports compression methods: **0** (stored), **8** (deflate)

## Testing
- Unit tests against known-good fixtures (stored + deflate)
- Validation that extracted bytes match standard unzip libraries for same entry
- Regression tests for EOCD search + central directory parsing edge cases (comments, ordering)

---

## Filing Instructions

1. Go to https://github.com/character-foundry/character-foundry/issues/new
2. Copy the relevant issue content
3. Add appropriate labels
4. Link back to this planning document
5. Track issue numbers below

## Issue Tracking

| Issue | Repository | Filed | Number | Status |
|-------|------------|-------|--------|--------|
| D1SyncStateStore | federation | [x] | [#10](https://github.com/character-foundry/character-foundry/issues/10) | Open |
| Token Counting | new package | [x] | [#11](https://github.com/character-foundry/character-foundry/issues/11) | Open |
| Metadata Validation | loader | [x] | [#13](https://github.com/character-foundry/character-foundry/issues/13) | Open |
| ImageService | media (existing #9) | [x] | [#9 comment](https://github.com/character-foundry/character-foundry/issues/9#issuecomment-3633858165) | Open |
| HTTP Signatures | federation | [x] | [#12](https://github.com/character-foundry/character-foundry/issues/12) | Open |
| Selective ZIP extraction | core / new package | [ ] |  | Draft |
