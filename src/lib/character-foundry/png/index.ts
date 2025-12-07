/**
 * @character-foundry/png
 *
 * PNG character card parser and builder.
 */

// Parser
export {
  PNG_SIGNATURE,
  TEXT_CHUNK_KEYS,
  type TextChunk,
  type PNGExtractionResult,
  isPNG,
  parseTextChunks,
  listChunks,
  extractFromPNG,
} from './parser';

// Builder
export {
  type EmbedOptions,
  removeAllTextChunks,
  injectTextChunk,
  embedIntoPNG,
  validatePNGSize,
} from './builder';

// CRC32
export {
  crc32,
  crc32Bytes,
} from './crc32';
