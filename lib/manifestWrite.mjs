import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isMap, isSeq, parseDocument } from 'yaml';
import { MANIFEST_FILE, parseManifest, validateManifest } from './manifest.mjs';

function parseManifestDocument(text) {
  const doc = parseDocument(text.replace(/^\uFEFF/, ''), {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: true,
  });
  if (doc.errors.length) {
    throw new Error(`invalid ${MANIFEST_FILE}: ${doc.errors.map((error) => error.message).join('; ')}`);
  }
  return doc;
}

export function manifestFilePath(repoPath = '.') {
  return join(resolve(repoPath), MANIFEST_FILE);
}

export async function readManifestDocument(repoPath = '.') {
  const path = manifestFilePath(repoPath);
  const text = await readFile(path, 'utf8');
  return { path, doc: parseManifestDocument(text) };
}

export function manifestFromDocument(doc) {
  return parseManifest(String(doc));
}

export function validateManifestDocument(doc) {
  const manifest = manifestFromDocument(doc);
  const errors = validateManifest(manifest, { requireGithubProfile: true });
  if (errors.length) {
    throw new Error(`invalid ${MANIFEST_FILE}: ${errors.join('; ')}`);
  }
  return manifest;
}

export async function updateManifestDocument(repoPath, update) {
  const { path, doc } = await readManifestDocument(repoPath);
  const result = await update(doc);
  const manifest = validateManifestDocument(doc);
  await writeFile(path, String(doc), 'utf8');
  return { path, manifest, ...(result || {}) };
}

export function getMap(doc, key) {
  const value = doc.get(key, true);
  if (!isMap(value)) return null;
  return value;
}

export function getSeq(doc, key) {
  const value = doc.get(key, true);
  if (!isSeq(value)) return null;
  return value;
}

export function ensureMap(doc, key) {
  let value = doc.get(key, true);
  if (value == null) {
    value = doc.createNode({});
    doc.set(key, value);
  }
  if (!isMap(value)) {
    throw new Error(`${key} must be a mapping`);
  }
  return value;
}

export function ensureNestedMap(doc, path) {
  let current = doc.contents;
  for (const key of path) {
    let next = current.get(key, true);
    if (next == null) {
      next = doc.createNode({});
      current.set(key, next);
    }
    if (!isMap(next)) {
      throw new Error(`${path.join('.')} must be a mapping`);
    }
    current = next;
  }
  return current;
}

export function ensureNestedSeq(doc, path) {
  const parent = ensureNestedMap(doc, path.slice(0, -1));
  const key = path.at(-1);
  let value = parent.get(key, true);
  if (value == null) {
    value = doc.createNode([]);
    parent.set(key, value);
  }
  if (!isSeq(value)) {
    throw new Error(`${path.join('.')} must be a sequence`);
  }
  return value;
}

export function deleteEmptyPayment(doc) {
  const payment = doc.getIn(['extensions', 'payment'], true);
  if (!isMap(payment)) return;
  const providers = payment.get('providers', true);
  if (isSeq(providers) && providers.items.length === 0) {
    doc.deleteIn(['extensions', 'payment']);
  }
}
