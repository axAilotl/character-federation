import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCard } from '@character-foundry/character-foundry/loader';

function getFixturesDir(): string | null {
  return process.env.CF_FIXTURES_DIR?.trim() || null;
}

function allowMissingFixtures(): boolean {
  const raw = (process.env.CF_ALLOW_MISSING_FIXTURES || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function toBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

type R2ObjectLike = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  httpMetadata?: unknown;
  customMetadata?: unknown;
  size?: number;
};

class MemoryR2 {
  private objects = new Map<string, Uint8Array>();
  public completedUploads: Array<{ key: string; uploadId: string; parts: unknown[] }> = [];

  put(key: string, data: ArrayBuffer | Uint8Array | Buffer): Promise<void> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.objects.set(key, bytes);
    return Promise.resolve();
  }

  async get(key: string): Promise<R2ObjectLike | null> {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      arrayBuffer: async () => bytes.slice().buffer,
      size: bytes.byteLength,
    };
  }

  async head(key: string): Promise<{ size: number } | null> {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.byteLength } : null;
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    return {
      complete: async (parts: unknown[]) => {
        this.completedUploads.push({ key, uploadId, parts });
      },
    };
  }
}

class MemoryDB {
  public cardsByUploadId = new Map<string, { id: string; slug: string; uploader_id: string; head_version_id: string }>();
  public versionsById = new Map<string, { card_data: string }>();
  public runs: Array<{ sql: string; params: unknown[] }> = [];

  prepare(sql: string) {
    return {
      get: (param: string) => {
        if (sql.includes('FROM cards') && sql.includes('upload_id')) {
          return this.cardsByUploadId.get(param);
        }
        if (sql.includes('SELECT card_data') && sql.includes('FROM card_versions')) {
          return this.versionsById.get(param);
        }
        return undefined;
      },
      run: (...params: unknown[]) => {
        this.runs.push({ sql, params });
        return { success: true };
      },
    };
  }
}

const r2 = new MemoryR2();
const db = new MemoryDB();

// Mocks MUST be declared before importing the route handler.
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'user_test', isAdmin: false } })),
}));

vi.mock('@/lib/cloudflare/env', () => ({
  getR2: vi.fn(async () => r2),
}));

vi.mock('@/lib/db/async-db', () => ({
  getDatabase: vi.fn(async () => db),
}));

vi.mock('@/lib/db', () => ({
  isCloudflareRuntime: vi.fn(() => true),
}));

vi.mock('@/lib/storage', () => ({
  store: vi.fn(async () => 'r2://mock'),
  getPublicUrl: vi.fn((url: string) => url),
}));

import { store } from '@/lib/storage';
import { POST } from '@/app/api/uploads/complete/route';

const fixturesDir = getFixturesDir();
const fixturesExist = fixturesDir !== null && fs.existsSync(fixturesDir);

const FIXTURE_REL = 'extended/charx/v3_many_assets_01.charx';

if (!fixturesExist) {
  if (allowMissingFixtures()) {
    describe.skip('POST /api/uploads/complete (golden assets)', () => {});
  } else {
    describe('POST /api/uploads/complete (golden assets)', () => {
      it('requires CF_FIXTURES_DIR', () => {
        throw new Error(
          `[fixtures] Missing fixtures directory\n` +
            `Set CF_FIXTURES_DIR to the golden fixtures root\n` +
            `or set CF_ALLOW_MISSING_FIXTURES=1 to skip this suite.`,
        );
      });
    });
  }
} else {
  describe('POST /api/uploads/complete (golden assets)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      db.cardsByUploadId.clear();
      db.versionsById.clear();
      db.runs.length = 0;
      r2.completedUploads.length = 0;
    });

    it('extracts non-main assets and rewrites embeded:// URLs', async () => {
      const absPath = path.join(fixturesDir, FIXTURE_REL);
      const fixtureBytes = toBytes(fs.readFileSync(absPath));

      // Pre-parse to know what the route should extract.
      const pre = parseCard(fixtureBytes, { extractAssets: true });
      const expectedNonMain = pre.assets.filter((a) => !a.isMain || a.type !== 'icon');
      expect(expectedNonMain.length).toBeGreaterThan(0);
      expect(JSON.stringify(pre.card).includes('embeded://')).toBe(true);

      const uploadId = 'upload_test_1';
      const key = 'cards/card_test_id.charx';

      // Seed R2 with the completed object (route calls resumeMultipartUpload.complete, then head/get).
      await r2.put(key, fixtureBytes);

      // Seed DB with a pending upload row + a version containing embeded:// references.
      db.cardsByUploadId.set(uploadId, {
        id: 'card_test_id',
        slug: 'test-slug',
        uploader_id: 'user_test',
        head_version_id: 'version_test_id',
      });
      db.versionsById.set('version_test_id', { card_data: JSON.stringify(pre.card) });

      const request = new Request('http://localhost/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          key,
          parts: [{ partNumber: 1, etag: 'etag1' }],
        }),
      });

      const response = await POST(request as never);
      expect(response.status).toBe(200);

      const payload = await response.json();
      expect(payload?.success).toBe(true);
      expect(payload?.cardId).toBe('card_test_id');
      expect(payload?.slug).toBe('test-slug');
      expect(payload?.assetsExtracted).toBe(expectedNonMain.length);

      // Route should have stored each non-main asset.
      const mockedStore = store as unknown as ReturnType<typeof vi.fn>;
      const storedAssetCalls = mockedStore.mock.calls.filter((call) => {
        const objectPath = call[1] as string;
        return typeof objectPath === 'string' && objectPath.startsWith(`assets/card_test_id/`);
      });
      expect(storedAssetCalls.length).toBe(expectedNonMain.length);

      // DB update should include rewritten card_data and saved_assets.
      const versionUpdate = db.runs.find((r) => r.sql.includes('UPDATE card_versions'));
      expect(versionUpdate).toBeTruthy();

      const params = (versionUpdate?.params || []) as unknown[];
      const savedAssetsJson = params[3] as string | null;
      const processedCardData = params[4] as string | null;

      expect(savedAssetsJson).toBeTruthy();
      const savedAssets = JSON.parse(savedAssetsJson as string) as Array<{ path: string }>;
      expect(savedAssets.length).toBe(expectedNonMain.length);

      expect(processedCardData).toBeTruthy();
      const sampleOriginalPath = expectedNonMain.find((a) => a.path)?.path;
      expect(sampleOriginalPath).toBeTruthy();
      expect(processedCardData).not.toContain(`embeded://${sampleOriginalPath as string}`);
      expect(processedCardData).toContain('/api/uploads/assets/card_test_id/');
    });
  });
}
