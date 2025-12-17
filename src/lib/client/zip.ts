/**
 * Minimal ZIP Central Directory reader (client-safe)
 *
 * Why this exists:
 * - Large `.charx` / `.voxpkg` uploads can be 100–400MB with thousands of assets.
 * - Streaming unzip approaches (fflate `Unzip`) still inflate every entry, even if we only need
 *   `card.json` or `Characters/<id>/character.json` + `thumbnail.*` for previews/metadata.
 *
 * This helper indexes the ZIP central directory, then inflates only selected entries.
 *
 * Limitations (by design for now):
 * - No ZIP64 support
 * - Only supports compression methods: 0 (stored) and 8 (deflate)
 *
 * Candidate for upstreaming into `@character-foundry/*` (core zip utilities).
 */

import { inflateSync } from 'fflate';

export type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CEN_SIGNATURE = 0x02014b50;
const LOC_SIGNATURE = 0x04034b50;

const textDecoder = new TextDecoder();

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(buffer: Uint8Array): number {
  // EOCD is at least 22 bytes, and comment length can be up to 65535.
  const maxSearch = Math.min(buffer.length - 22, 22 + 0xffff);
  const start = buffer.length - 22;
  const min = Math.max(0, buffer.length - maxSearch);

  for (let i = start; i >= min; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

export function indexZip(buffer: Uint8Array): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) {
    throw new Error('ZIP: End of central directory not found');
  }

  const sig = u32(view, eocdOffset);
  if (sig !== EOCD_SIGNATURE) {
    throw new Error('ZIP: Invalid EOCD signature');
  }

  const totalEntries = u16(view, eocdOffset + 10);
  const centralDirSize = u32(view, eocdOffset + 12);
  const centralDirOffset = u32(view, eocdOffset + 16);

  // ZIP64 not supported in this minimal reader.
  if (totalEntries === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff) {
    throw new Error('ZIP64 is not supported');
  }

  const entries: ZipEntry[] = [];
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.length) break;
    const cenSig = u32(view, cursor);
    if (cenSig !== CEN_SIGNATURE) break;

    const compressionMethod = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const fileNameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localHeaderOffset = u32(view, cursor + 42);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) break;

    const name = textDecoder.decode(buffer.slice(nameStart, nameEnd));

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}

export function extractZipEntry(buffer: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const offset = entry.localHeaderOffset;

  if (offset + 30 > buffer.length) {
    throw new Error(`ZIP: Local header out of range for "${entry.name}"`);
  }

  const locSig = u32(view, offset);
  if (locSig !== LOC_SIGNATURE) {
    throw new Error(`ZIP: Invalid local header signature for "${entry.name}"`);
  }

  const fileNameLength = u16(view, offset + 26);
  const extraLength = u16(view, offset + 28);

  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buffer.length) {
    throw new Error(`ZIP: Compressed data out of range for "${entry.name}"`);
  }

  const compressed = buffer.slice(dataStart, dataEnd);

  // 0 = stored (no compression), 8 = deflate
  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return inflateSync(compressed);
  }

  throw new Error(`ZIP: Unsupported compression method ${entry.compressionMethod} for "${entry.name}"`);
}
