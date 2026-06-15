import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashDigestError, hashText } from './hash.mjs';
import { acquireFileLock } from './fileLock.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';
import { resolveInputDigest } from './task.mjs';
import { deliveryIntentDigest } from './extensions/delivery/schema.mjs';

export const CREDENTIAL_SCHEME = 'voucher-hmac-v1';
const CREDENTIAL_RE = /^crv1_([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{43})$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function generateCredential() {
  const credentialId = randomBytes(12).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return {
    credential_id: credentialId,
    secret,
    value: `crv1_${credentialId}.${secret}`,
  };
}

export function parseCredential(value) {
  const match = CREDENTIAL_RE.exec(String(value || ''));
  if (!match) throw new Error('invalid credential: expected crv1_<id>.<secret>');
  return { credential_id: match[1], secret: match[2] };
}

export function credentialDigest(credentialId, secret) {
  return hashText(`crv1_${credentialId}.${secret}`);
}

export function canonicalCredentialIntent(task, manifest, credentialId) {
  const deliveryDigest = deliveryIntentDigest(task);
  return JSON.stringify({
    version: PROTOCOL_VERSION,
    scheme: CREDENTIAL_SCHEME,
    node_identity: manifest.identity.public_key,
    credential_id: credentialId,
    request_id: task.request_id,
    capability_id: task.capability_id,
    input_digest: resolveInputDigest(task),
    ...(deliveryDigest ? { delivery_intent_digest: deliveryDigest } : {}),
    expires: task.expires,
  });
}

export function taskIntentDigest(task, manifest, credentialId) {
  return hashText(canonicalCredentialIntent(task, manifest, credentialId));
}

export function authorizeCredential(task, manifest, credential) {
  const parsed = typeof credential === 'string' ? parseCredential(credential) : credential;
  const payload = canonicalCredentialIntent(task, manifest, parsed.credential_id);
  return {
    scheme: CREDENTIAL_SCHEME,
    credential_id: parsed.credential_id,
    authorization: createHmac('sha256', parsed.secret)
      .update(payload, 'utf8')
      .digest('base64url'),
  };
}

export function verifyCredentialAuthorization(task, manifest, taskCredential, record, now = new Date()) {
  if (!taskCredential) return { ok: false, reason: 'missing credential' };
  if (taskCredential.scheme !== CREDENTIAL_SCHEME) {
    return { ok: false, reason: 'unsupported credential scheme' };
  }
  if (!record) return { ok: false, reason: `unknown credential_id: ${taskCredential.credential_id}` };
  if (record.status === 'revoked') return { ok: false, reason: 'credential revoked' };
  if (record.expires && Date.parse(record.expires) < now.getTime()) {
    return { ok: false, reason: 'credential expired' };
  }
  if (record.capability_id && record.capability_id !== task.capability_id) {
    return { ok: false, reason: 'credential capability mismatch' };
  }
  const expected = authorizeCredential(task, manifest, {
    credential_id: record.credential_id,
    secret: record.secret,
  }).authorization;
  const left = Buffer.from(String(taskCredential.authorization || ''));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: 'invalid credential authorization' };
  }
  return {
    ok: true,
    reason: null,
    credential_digest: credentialDigest(record.credential_id, record.secret),
    task_intent_digest: taskIntentDigest(task, manifest, record.credential_id),
  };
}

export async function loadCredentialStore(path) {
  if (!path) return { version: '1', credentials: [] };
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed?.version !== '1' || !Array.isArray(parsed.credentials)) {
      throw new Error('invalid credential store');
    }
    for (const record of parsed.credentials) {
      if (!ID_RE.test(String(record?.credential_id || ''))
        || !/^[A-Za-z0-9_-]{43}$/.test(String(record?.secret || ''))
        || !['available', 'revoked'].includes(record?.status)) {
        throw new Error('invalid credential store record');
      }
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: '1', credentials: [] };
    throw error;
  }
}

export async function writeCredentialStore(path, store) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, path);
}

async function acquireCredentialStoreLock(path, {
  timeoutMs = 5000,
  retryMs = 25,
} = {}) {
  return acquireFileLock(`${path}.lock`, {
    conflictMessage: `credential store is busy: ${path}`,
    timeoutMs,
    retryMs,
  });
}

export async function updateCredentialStore(path, update) {
  const release = await acquireCredentialStoreLock(path);
  try {
    const store = await loadCredentialStore(path);
    await update(store);
    await writeCredentialStore(path, store);
    return store;
  } finally {
    await release();
  }
}

export function findCredential(store, credentialId) {
  if (!ID_RE.test(String(credentialId || ''))) return null;
  return store.credentials.find((item) => item.credential_id === credentialId) || null;
}

export function publicCredentialRecord(record, redemptions = []) {
  const redemption = redemptions.find((item) => item.credential_id === record.credential_id);
  const expired = !!record.expires && Date.parse(record.expires) < Date.now();
  return {
    credential_id: record.credential_id,
    capability_id: record.capability_id,
    status: redemption ? 'redeemed' : expired ? 'expired' : record.status,
    created_at: record.created_at,
    expires: record.expires || null,
    ...(redemption ? { request_id: redemption.request_id, redeemed_at: redemption.redeemed_at } : {}),
  };
}

export function parseRedemptionsLog(text) {
  const records = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    records.push(JSON.parse(trimmed));
  }
  return records;
}

export function validateRedemption(record) {
  const errors = [];
  if (record?.version !== '1') errors.push('invalid redemption version');
  if (!record?.request_id) errors.push('missing redemption request_id');
  if (!ID_RE.test(String(record?.credential_id || ''))) errors.push('invalid redemption credential_id');
  if (hashDigestError(record?.credential_digest, 'redemption credential_digest')) {
    errors.push('invalid redemption credential_digest');
  }
  if (hashDigestError(record?.task_intent_digest, 'redemption task_intent_digest')) {
    errors.push('invalid redemption task_intent_digest');
  }
  if (!record?.capability_id) errors.push('missing redemption capability_id');
  if (!record?.redeemed_at || Number.isNaN(Date.parse(record.redeemed_at))) {
    errors.push('invalid redemption redeemed_at');
  }
  return errors;
}

export async function loadRedemptions(path) {
  try {
    return parseRedemptionsLog(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function findCredentialRedemption(redemptions, credentialId) {
  return redemptions.find((item) => item.credential_id === credentialId) || null;
}

export async function appendRedemption(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}
