/**
 * Tests for @character-foundry/* security packages (0.x.x-security.0)
 *
 * Verifies:
 * 1. Core utilities (UUID, errors, data URLs)
 * 2. Loader parsing
 * 3. Federation types and stores
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  // Error types
  FoundryError,
  ParseError,
  ValidationError,
  PathTraversalError,
  SizeLimitError,
  isFoundryError,
  wrapError,
  // UUID utilities
  generateUUID,
  isValidUUID,
  // Data URL utilities
  toDataURL,
  fromDataURL,
  isDataURL,
  // Binary utilities
  fromString,
} from '@character-foundry/character-foundry/core';

import {
  parseCard,
  detectFormat,
} from '@character-foundry/character-foundry/loader';

import {
  isFederationEnabled,
  MemorySyncStateStore,
  type CardSyncState,
  type SyncStateStore,
  // HTTP Signatures (Issue #12 - now implemented)
  parseSignatureHeader,
  buildSigningString,
  calculateDigest,
} from '@character-foundry/character-foundry/federation';

import {
  // Token counting (Issue #11 - now implemented)
  countCardTokens,
  countText,
} from '@character-foundry/character-foundry/tokenizers';

describe('@character-foundry/core - Error Types', () => {
  it('should create FoundryError with code', () => {
    const error = new FoundryError('Test error', 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error).toBeInstanceOf(Error);
  });

  it('should create ParseError', () => {
    const error = new ParseError('Invalid JSON', 'png');
    expect(error.message).toBe('Invalid JSON');
    expect(error.code).toBe('PARSE_ERROR');
    expect(error.format).toBe('png');
  });

  it('should create ValidationError', () => {
    const error = new ValidationError('Missing name field', 'name');
    expect(error.message).toBe('Missing name field');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('name');
  });

  it('should create PathTraversalError', () => {
    const error = new PathTraversalError('../etc/passwd');
    expect(error.code).toBe('PATH_TRAVERSAL');
    expect(error.path).toBe('../etc/passwd');
  });

  it('should create SizeLimitError', () => {
    const error = new SizeLimitError(100 * 1024 * 1024, 50 * 1024 * 1024, 'file');
    expect(error.code).toBe('SIZE_LIMIT_EXCEEDED');
    expect(error.actualSize).toBe(100 * 1024 * 1024);
    expect(error.maxSize).toBe(50 * 1024 * 1024);
  });

  it('isFoundryError should identify Foundry errors', () => {
    const foundryError = new ParseError('test');
    const regularError = new Error('test');

    expect(isFoundryError(foundryError)).toBe(true);
    expect(isFoundryError(regularError)).toBe(false);
    expect(isFoundryError(null)).toBe(false);
    expect(isFoundryError('string')).toBe(false);
  });

  it('wrapError should wrap unknown errors', () => {
    const wrapped1 = wrapError(new Error('original'));
    expect(isFoundryError(wrapped1)).toBe(true);
    expect(wrapped1.message).toContain('original');

    const wrapped2 = wrapError('string error');
    expect(isFoundryError(wrapped2)).toBe(true);

    // Already a FoundryError should pass through
    const parseError = new ParseError('already wrapped');
    const wrapped3 = wrapError(parseError);
    expect(wrapped3).toBe(parseError);
  });
});

describe('@character-foundry/core - UUID Utilities', () => {
  it('should generate valid UUID v4', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique UUIDs', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });

  it('should validate UUID format', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false); // too short
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
  });
});

describe('@character-foundry/core - Data URL Utilities', () => {
  it('should convert buffer to data URL', () => {
    const buffer = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
    const dataUrl = toDataURL(buffer, 'image/png');

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(isDataURL(dataUrl)).toBe(true);
  });

  it('should parse data URL back to buffer', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const dataUrl = toDataURL(original, 'application/octet-stream');
    const { buffer, mimeType } = fromDataURL(dataUrl);

    expect(buffer).toEqual(original);
    expect(mimeType).toBe('application/octet-stream');
  });

  it('should validate data URL format', () => {
    expect(isDataURL('data:text/plain;base64,SGVsbG8=')).toBe(true);
    expect(isDataURL('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isDataURL('https://example.com/image.png')).toBe(false);
    expect(isDataURL('not a url')).toBe(false);
  });
});

describe('@character-foundry/loader - Format Detection', () => {
  it('should detect PNG format', () => {
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const result = detectFormat(pngMagic);
    expect(result.format).toBe('png');
    expect(result.confidence).toBe('high');
  });

  it('should detect JSON format', () => {
    const jsonBuffer = fromString(JSON.stringify({ spec: 'chara_card_v3', data: {} }));
    const result = detectFormat(jsonBuffer);
    expect(result.format).toBe('json');
  });

  it('should detect ZIP/CharX format', () => {
    // ZIP magic bytes
    const zipMagic = new Uint8Array([0x50, 0x4B, 0x03, 0x04]);
    const result = detectFormat(zipMagic);
    expect(['charx', 'voxta', 'unknown']).toContain(result.format);
  });

  it('should return unknown for invalid data', () => {
    const garbage = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const result = detectFormat(garbage);
    expect(result.format).toBe('unknown');
  });
});

describe('@character-foundry/loader - Card Parsing', () => {
  it('should parse minimal JSON card', () => {
    const cardJson = JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Test Character',
        description: 'A test character',
        personality: 'Friendly',
        first_mes: 'Hello!',
        mes_example: '',
        scenario: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        tags: [],
        creator: 'Test',
        character_version: '1.0',
        alternate_greetings: [],
        group_only_greetings: [],
      },
    });

    const buffer = fromString(cardJson);
    const result = parseCard(buffer);

    expect(result.card).toBeDefined();
    expect(result.card.data.name).toBe('Test Character');
    expect(result.containerFormat).toBe('json');
    expect(result.spec).toBe('v3');
  });

  it('should handle parse errors gracefully', () => {
    const invalidJson = fromString('{ not valid json }');

    expect(() => parseCard(invalidJson)).toThrow();
  });
});

describe('@character-foundry/federation - State Store', () => {
  it('federation should be disabled by default', () => {
    expect(isFederationEnabled()).toBe(false);
  });

  describe('MemorySyncStateStore', () => {
    let store: SyncStateStore;

    beforeAll(() => {
      store = new MemorySyncStateStore();
    });

    it('should store and retrieve state', async () => {
      const state: CardSyncState = {
        localId: 'local-123',
        federatedId: 'https://example.com/cards/123',
        platformIds: { archive: 'local-123' },
        lastSync: { archive: new Date().toISOString() },
        versionHash: 'abc123',
        status: 'synced',
      };

      await store.set(state);
      const retrieved = await store.get(state.federatedId);

      expect(retrieved).toEqual(state);
    });

    it('should return null for missing state', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete state', async () => {
      const state: CardSyncState = {
        localId: 'to-delete',
        federatedId: 'https://example.com/cards/delete',
        platformIds: {},
        lastSync: {},
        versionHash: 'xyz',
        status: 'pending',
      };

      await store.set(state);
      await store.delete(state.federatedId);
      const result = await store.get(state.federatedId);

      expect(result).toBeNull();
    });

    it('should find by platform ID', async () => {
      const state: CardSyncState = {
        localId: 'platform-test',
        federatedId: 'https://example.com/cards/platform',
        platformIds: { sillytavern: 'st-card-456' },
        lastSync: {},
        versionHash: 'hash',
        status: 'synced',
      };

      await store.set(state);
      const found = await store.findByPlatformId('sillytavern', 'st-card-456');

      expect(found).toEqual(state);
    });

    it('should list all states', async () => {
      const newStore = new MemorySyncStateStore();

      await newStore.set({
        localId: '1',
        federatedId: 'fed-1',
        platformIds: {},
        lastSync: {},
        versionHash: 'h1',
        status: 'synced',
      });

      await newStore.set({
        localId: '2',
        federatedId: 'fed-2',
        platformIds: {},
        lastSync: {},
        versionHash: 'h2',
        status: 'pending',
      });

      const all = await newStore.list();
      expect(all.length).toBe(2);
    });
  });
});

describe('@character-foundry/tokenizers - Token Counting (Issue #11)', () => {
  it('should count tokens in text', () => {
    const count = countText('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(typeof count).toBe('number');
  });

  it('should count tokens in a character card', () => {
    const card = {
      data: {
        name: 'Test Character',
        description: 'A brave warrior from the northern lands.',
        personality: 'Courageous and loyal',
        scenario: 'Medieval fantasy world',
        first_mes: 'Hello traveler!',
        mes_example: '<START>{{user}}: Hi\n{{char}}: Hello!',
        system_prompt: 'You are a medieval warrior.',
        post_history_instructions: '',
        alternate_greetings: ['Greetings!', 'Well met!'],
        creator_notes: 'This is a test character.',
        character_book: {
          entries: [
            { content: 'Lore entry 1', enabled: true },
            { content: 'Lore entry 2', enabled: false },
          ],
        },
      },
    };

    const counts = countCardTokens(card);

    expect(counts.description).toBeGreaterThan(0);
    expect(counts.personality).toBeGreaterThan(0);
    expect(counts.firstMes).toBeGreaterThan(0);
    expect(counts.alternateGreetings).toBeGreaterThan(0);
    expect(counts.lorebook).toBeGreaterThan(0); // Only enabled entries by default
    expect(counts.total).toBeGreaterThan(0);
    expect(counts.total).toBe(
      counts.description +
      counts.personality +
      counts.scenario +
      counts.firstMes +
      counts.mesExample +
      counts.systemPrompt +
      counts.postHistoryInstructions +
      counts.alternateGreetings +
      counts.lorebook +
      counts.creatorNotes
    );
  });

  it('should handle empty card', () => {
    const counts = countCardTokens({});
    expect(counts.total).toBe(0);
  });
});

describe('@character-foundry/federation - HTTP Signatures (Issue #12)', () => {
  it('should parse valid signature header', () => {
    const header = 'keyId="https://example.com/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="abc123=="';
    const parsed = parseSignatureHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.keyId).toBe('https://example.com/actor#main-key');
    expect(parsed!.algorithm).toBe('rsa-sha256');
    expect(parsed!.headers).toEqual(['(request-target)', 'host', 'date']);
    expect(parsed!.signature).toBe('abc123==');
  });

  it('should return null for invalid signature header', () => {
    const parsed = parseSignatureHeader('invalid-header');
    expect(parsed).toBeNull();
  });

  it('should build signing string from headers', () => {
    const headers = new Headers({
      'host': 'example.com',
      'date': 'Sun, 09 Dec 2025 12:00:00 GMT',
    });

    const signingString = buildSigningString('POST', '/inbox', headers, ['(request-target)', 'host', 'date']);

    expect(signingString).toContain('(request-target): post /inbox');
    expect(signingString).toContain('host: example.com');
    expect(signingString).toContain('date: Sun, 09 Dec 2025 12:00:00 GMT');
  });

  it('should calculate SHA-256 digest', async () => {
    const body = '{"type":"Create"}';
    const digest = await calculateDigest(body);

    expect(digest).toMatch(/^SHA-256=/);
    // SHA-256 base64 is always 44 chars
    expect(digest.length).toBe(52); // "SHA-256=" (8) + base64 (44)
  });
});

describe('Package Versions', () => {
  it('should have security-tagged versions installed', async () => {
    // This test verifies the packages are actually installed
    const coreIndex = await import('@character-foundry/character-foundry/core');
    const loaderIndex = await import('@character-foundry/character-foundry/loader');
    const fedIndex = await import('@character-foundry/character-foundry/federation');

    // These should exist in security packages
    expect(typeof coreIndex.generateUUID).toBe('function');
    expect(typeof coreIndex.toDataURL).toBe('function');
    expect(typeof loaderIndex.parseCard).toBe('function');
    expect(typeof fedIndex.MemorySyncStateStore).toBe('function');

    // HTTP Signatures should now be exported (Issue #12)
    expect(typeof fedIndex.parseSignatureHeader).toBe('function');
    expect(typeof fedIndex.buildSigningString).toBe('function');
    expect(typeof fedIndex.verifyHttpSignature).toBe('function');
    expect(typeof fedIndex.signRequest).toBe('function');
    expect(typeof fedIndex.calculateDigest).toBe('function');
  });
});
