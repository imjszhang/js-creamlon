import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function hashText(text) {
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export async function hashFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  return hashText(content);
}

export function hashDigestError(digest, label = 'hash') {
  if (typeof digest !== 'string' || !HASH_PATTERN.test(digest)) {
    return `invalid ${label}: expected sha256:<64 hex chars>`;
  }
  return null;
}

export function assertValidHashDigest(digest, label = 'hash') {
  const err = hashDigestError(digest, label);
  if (err) {
    const error = new Error(err);
    error.exitCode = 1;
    throw error;
  }
}
