import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const ROOT_MANIFEST_FILE = 'creamlon.yaml';
export const BUNDLED_MANIFEST_FILE = '.creamlon/manifest.yaml';
export const MANIFEST_FILES = [BUNDLED_MANIFEST_FILE, ROOT_MANIFEST_FILE];

export const ROOT_TRUST_DIR = 'trust';
export const BUNDLED_TRUST_DIR = '.creamlon/trust';
export const PRIVATE_RUNTIME_DIR = '.creamlon/runtime';

export function localManifestFilePath(repoPath = '.') {
  return join(resolve(repoPath), ROOT_MANIFEST_FILE);
}

export function localBundledManifestFilePath(repoPath = '.') {
  return join(resolve(repoPath), BUNDLED_MANIFEST_FILE);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function privateRuntimeDir(repoPath = '.') {
  return join(resolve(repoPath), PRIVATE_RUNTIME_DIR);
}

export async function privateStatePath(repoPath, name, legacyPath, options = {}) {
  const { preferExisting = true } = options;
  const runtimePath = join(privateRuntimeDir(repoPath), name);
  const oldPath = legacyPath || join(resolve(repoPath), '.creamlon', name);
  if (preferExisting && await exists(oldPath) && !(await exists(runtimePath))) return oldPath;
  return runtimePath;
}

export function privateRuntimeRelativePath(name) {
  return `${PRIVATE_RUNTIME_DIR}/${name}`.replace(/\\/g, '/');
}

export function legacyPrivateRelativePath(name) {
  return `.creamlon/${name}`.replace(/\\/g, '/');
}

export function privateRuntimeFilePath(repoPath, name) {
  return join(privateRuntimeDir(repoPath), name);
}

export function privateRuntimeDirPath(repoPath, name) {
  return join(privateRuntimeDir(repoPath), name);
}

export function legacyPrivateFilePath(repoPath, name) {
  return join(resolve(repoPath), '.creamlon', name);
}

export async function privateKeyFilePath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'private.key', null, options);
}

export async function deliveryPrivateKeyFilePath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'delivery.private.b64url', null, options);
}

export async function credentialsFilePath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'credentials.json', null, options);
}

export async function authorizationKeysFilePath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'authorization.keys.json', null, options);
}

export async function deliverLockFilePath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'deliver.lock', null, options);
}

export async function discoveryCacheFilePath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, join('cache', 'discovery.json'), join(resolve(repoPath), '.creamlon', 'cache', 'discovery.json'), options);
}

export async function deliveriesDirPath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'deliveries', null, options);
}

export async function outboxDirPath(repoPath = '.', options = {}) {
  return privateStatePath(repoPath, 'outbox', null, options);
}

export async function resolveLocalManifestFilePath(repoPath = '.') {
  const bundledPath = localBundledManifestFilePath(repoPath);
  if (await exists(bundledPath)) return bundledPath;
  return localManifestFilePath(repoPath);
}

export async function readLocalManifestFile(repoPath = '.') {
  const path = await resolveLocalManifestFilePath(repoPath);
  const text = await readFile(path, 'utf8');
  return { path, text };
}

async function usesBundledLayout(repoPath = '.') {
  return exists(localBundledManifestFilePath(repoPath));
}

export async function publicTrustFilePath(repoPath, fileName, options = {}) {
  const { preferExisting = true } = options;
  const root = join(resolve(repoPath), ROOT_TRUST_DIR, fileName);
  const bundled = join(resolve(repoPath), BUNDLED_TRUST_DIR, fileName);
  if (preferExisting) {
    if (await exists(bundled)) return bundled;
    if (await exists(root)) return root;
  }
  return (await usesBundledLayout(repoPath)) ? bundled : root;
}

export async function publicTrustRelativePath(repoPath, fileName, options = {}) {
  const path = await publicTrustFilePath(repoPath, fileName, options);
  return path.includes(`${BUNDLED_TRUST_DIR}/`)
    ? `${BUNDLED_TRUST_DIR}/${fileName}`
    : `${ROOT_TRUST_DIR}/${fileName}`;
}

export async function readPublicTrustFile(repoPath, fileName, options = {}) {
  const { optional = false } = options;
  const bundled = join(resolve(repoPath), BUNDLED_TRUST_DIR, fileName);
  const root = join(resolve(repoPath), ROOT_TRUST_DIR, fileName);
  for (const path of [bundled, root]) {
    try {
      return { path, text: await readFile(path, 'utf8') };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (optional) return { path: await publicTrustFilePath(repoPath, fileName, { preferExisting: false }), text: '' };
  const error = new Error(`missing public trust file: ${BUNDLED_TRUST_DIR}/${fileName} or ${ROOT_TRUST_DIR}/${fileName}`);
  error.code = 'ENOENT';
  throw error;
}

export function publicTrustFiles(fileName) {
  return [`${BUNDLED_TRUST_DIR}/${fileName}`, `${ROOT_TRUST_DIR}/${fileName}`];
}

export async function fetchRepositoryFilePreferred(repository, fetchFile, paths, ref, options = {}) {
  const { optional = false } = options;
  const errors = [];
  for (const path of paths) {
    try {
      const text = await fetchFile(repository, path, ref, true);
      if (text != null) return { path, text };
    } catch (error) {
      errors.push(error);
    }
  }
  if (optional) return { path: paths[0], text: null };
  const error = errors[0] || new Error(`missing file: ${paths.join(' or ')}`);
  throw error;
}
