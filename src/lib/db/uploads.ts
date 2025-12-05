import { nanoid } from 'nanoid';
import { createHash, randomBytes } from 'crypto';
import { getDb } from './index';

export type UploadVisibility = 'public' | 'unlisted' | 'private';

export interface UploadRow {
  id: string;
  storage_url: string;
  path: string;
  uploader_id: string | null;
  visibility: UploadVisibility;
  access_token_hash: string | null;
  created_at: number;
}

export interface CreateUploadInput {
  storageUrl: string;
  path: string;
  uploaderId: string | null;
  visibility?: UploadVisibility;
  accessTokenHash?: string | null;
}

export function createUpload(input: CreateUploadInput): { id: string } {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    `
    INSERT INTO uploads (id, storage_url, path, uploader_id, visibility, access_token_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    input.storageUrl,
    input.path,
    input.uploaderId,
    input.visibility || 'public',
    input.accessTokenHash || null
  );

  return { id };
}

export function getUploadById(id: string): UploadRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
  return row || null;
}

export function getUploadByPath(path: string): UploadRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM uploads WHERE path = ?').get(path) as UploadRow | undefined;
  return row || null;
}

export function updateUploadVisibility(id: string, visibility: UploadVisibility, accessTokenHash: string | null): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE uploads
    SET visibility = ?, access_token_hash = ?
    WHERE id = ?
  `
  ).run(visibility, accessTokenHash, id);
}

export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyToken(token: string, hash: string | null): boolean {
  if (!hash) return false;
  return hashToken(token) === hash;
}
