import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { parseRepoSlug } from './manifest.mjs';
import { isSafeGithubArtifactPath } from './extensions/delivery/schema.mjs';
import { acquireFileLock } from './fileLock.mjs';

export const INBOX_REGISTRY_VERSION = '1';
export const DEFAULT_INBOX_REGISTRY = '.creamlon/caller/inboxes.yaml';
export const INBOX_TRUST_LEVELS = new Set(['trusted', 'trial', 'blocked']);
const ROOT_KEYS = new Set(['version', 'inboxes']);
const ENTRY_KEYS = new Set([
  'node',
  'operator',
  'repo',
  'ref',
  'trust',
  'path_template',
  'grant',
  'granted_at',
]);
const PATH_TEMPLATE_KEYS = new Set(['input', 'output']);
const GRANT_RE = /^(?:owner-admin|invitation-pending-(?:push|maintain|admin)|collaborator-(?:push|write|maintain|admin))$/;

function parseRegistryYaml(text, path) {
  const doc = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: true,
  });
  if (doc.errors.length) {
    throw new Error(`invalid inbox registry ${path}: ${doc.errors.map((error) => error.message).join('; ')}`);
  }
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid inbox registry ${path}: expected a mapping`);
  }
  return value;
}

function validateGithubRepo(value) {
  if (!/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || '')) {
    throw new Error(`invalid inbox repository: ${value || '<missing>'}`);
  }
}

function validatePathTemplate(value, field) {
  if (!value || typeof value !== 'string' || !value.includes('{request_id}')) {
    throw new Error(`inbox ${field} must contain {request_id}`);
  }
  if (!isSafeGithubArtifactPath(value)) {
    throw new Error(`inbox ${field} must be a relative repository path`);
  }
}

export function normalizeInboxEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('invalid inbox entry: expected a mapping');
  }
  const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key));
  if (unknown.length) throw new Error(`unknown inbox fields: ${unknown.join(', ')}`);
  const node = String(entry.node || '').toLowerCase();
  parseRepoSlug(node);
  const repo = String(entry.repo || '');
  validateGithubRepo(repo);
  const operator = String(entry.operator || '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(operator)) {
    throw new Error(`invalid inbox operator: ${entry?.operator || '<missing>'}`);
  }
  const trust = String(entry.trust || 'trusted');
  if (!INBOX_TRUST_LEVELS.has(trust)) throw new Error(`invalid inbox trust level: ${trust}`);
  const input = entry?.path_template?.input || 'tasks/{request_id}/input.enc';
  const output = entry?.path_template?.output || 'tasks/{request_id}/output.enc';
  if (entry.path_template != null
    && (!entry.path_template || typeof entry.path_template !== 'object'
      || Array.isArray(entry.path_template))) {
    throw new Error('inbox path_template must be a mapping');
  }
  const unknownPathKeys = Object.keys(entry.path_template || {})
    .filter((key) => !PATH_TEMPLATE_KEYS.has(key));
  if (unknownPathKeys.length) {
    throw new Error(`unknown inbox path_template fields: ${unknownPathKeys.join(', ')}`);
  }
  validatePathTemplate(input, 'input path template');
  validatePathTemplate(output, 'output path template');
  if (entry.grant != null && !GRANT_RE.test(entry.grant)) {
    throw new Error(`invalid inbox grant: ${entry.grant}`);
  }
  if (entry.granted_at != null
    && (typeof entry.granted_at !== 'string' || Number.isNaN(Date.parse(entry.granted_at)))) {
    throw new Error(`invalid inbox granted_at: ${entry.granted_at}`);
  }
  const ref = entry.ref || 'main';
  if (typeof ref !== 'string' || /[\u0000-\u001f\u007f]/.test(ref)) {
    throw new Error('invalid inbox ref');
  }
  return {
    node,
    operator,
    repo,
    ref,
    trust,
    path_template: { input, output },
    grant: entry.grant || null,
    granted_at: entry.granted_at || null,
  };
}

export function parseInboxRegistry(text, path = '<memory>') {
  const raw = parseRegistryYaml(text, path);
  const unknown = Object.keys(raw).filter((key) => !ROOT_KEYS.has(key));
  if (unknown.length) throw new Error(`unknown inbox registry fields: ${unknown.join(', ')}`);
  if (String(raw.version || '') !== INBOX_REGISTRY_VERSION) {
    throw new Error(`unsupported inbox registry version: ${raw.version || '<missing>'}`);
  }
  if (!Array.isArray(raw.inboxes)) throw new Error('invalid inbox registry: inboxes must be an array');
  const inboxes = raw.inboxes.map(normalizeInboxEntry);
  if (new Set(inboxes.map((entry) => entry.node)).size !== inboxes.length) {
    throw new Error('invalid inbox registry: duplicate node');
  }
  return { version: INBOX_REGISTRY_VERSION, inboxes };
}

export async function readInboxRegistry(path = DEFAULT_INBOX_REGISTRY, { optional = true } = {}) {
  const absolute = resolve(path);
  try {
    return parseInboxRegistry(await readFile(absolute, 'utf8'), absolute);
  } catch (error) {
    if (optional && error.code === 'ENOENT') {
      return { version: INBOX_REGISTRY_VERSION, inboxes: [] };
    }
    throw error;
  }
}

export async function writeInboxRegistry(path, registry) {
  const absolute = resolve(path || DEFAULT_INBOX_REGISTRY);
  const normalized = {
    version: INBOX_REGISTRY_VERSION,
    inboxes: (registry?.inboxes || []).map(normalizeInboxEntry),
  };
  await mkdir(dirname(absolute), { recursive: true });
  const tempPath = `${absolute}.${process.pid}.tmp`;
  await writeFile(tempPath, stringify(normalized), { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, absolute);
  return absolute;
}

export async function updateInboxRegistry(path, updater) {
  const absolute = resolve(path || DEFAULT_INBOX_REGISTRY);
  const release = await acquireFileLock(`${absolute}.lock`, {
    conflictMessage: `inbox registry update already in progress: ${absolute}`,
    timeoutMs: 5000,
  });
  try {
    const current = await readInboxRegistry(absolute);
    const updated = await updater(current);
    await writeInboxRegistry(absolute, updated);
    return { path: absolute, registry: updated };
  } finally {
    await release();
  }
}

export function findInbox(registry, node) {
  const normalized = String(node || '').toLowerCase();
  return registry?.inboxes?.find((entry) => entry.node === normalized) || null;
}

export function upsertInbox(registry, entry) {
  const normalized = normalizeInboxEntry(entry);
  const inboxes = [...(registry?.inboxes || [])];
  const index = inboxes.findIndex((item) => item.node === normalized.node);
  if (index === -1) inboxes.push(normalized);
  else inboxes[index] = normalized;
  inboxes.sort((a, b) => a.node.localeCompare(b.node));
  return { version: INBOX_REGISTRY_VERSION, inboxes };
}

export function removeInbox(registry, node) {
  const normalized = String(node || '').toLowerCase();
  return {
    version: INBOX_REGISTRY_VERSION,
    inboxes: (registry?.inboxes || []).filter((entry) => entry.node !== normalized),
  };
}
