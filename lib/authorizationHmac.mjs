import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PROTOCOL_VERSION } from './protocol.mjs';
import { resolveInputDigest } from './task.mjs';

export function canonicalAuthorizationPayload(task, authorization) {
  return JSON.stringify({
    version: PROTOCOL_VERSION,
    scheme: 'hmac-sha256',
    key_id: authorization.key_id,
    request_id: task.request_id,
    capability_id: task.capability_id,
    input_digest: resolveInputDigest(task),
    expires: authorization.expires,
  });
}

export function signHmacAuthorization(task, { keyId, secret, expires }) {
  const authorization = {
    scheme: 'hmac-sha256',
    key_id: keyId,
    expires,
  };
  authorization.signature = createHmac('sha256', secret)
    .update(canonicalAuthorizationPayload(task, authorization), 'utf8')
    .digest('base64url');
  return authorization;
}

export function verifyHmacAuthorization(task, authorization, keys, now = new Date()) {
  if (!authorization) return { ok: false, reason: 'missing authorization' };
  if (authorization.scheme !== 'hmac-sha256') {
    return { ok: false, reason: 'unsupported authorization scheme' };
  }
  const expiresAt = Date.parse(authorization.expires);
  if (Number.isNaN(expiresAt)) return { ok: false, reason: 'invalid authorization.expires' };
  if (expiresAt < now.getTime()) return { ok: false, reason: 'authorization expired' };
  const secret = keys?.get(authorization.key_id);
  if (!secret) return { ok: false, reason: `unknown authorization.key_id: ${authorization.key_id}` };
  const expected = signHmacAuthorization(task, {
    keyId: authorization.key_id,
    secret,
    expires: authorization.expires,
  }).signature;
  const left = Buffer.from(String(authorization.signature));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right)
    ? { ok: true, reason: null }
    : { ok: false, reason: 'invalid authorization signature' };
}

export async function loadHmacKeys(filePath) {
  const keys = new Map();
  if (!filePath) return keys;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    for (const [keyId, secret] of Object.entries(parsed)) keys.set(keyId, String(secret));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return keys;
}

export function generateHmacSecret(bytes) {
  return Buffer.from(bytes).toString('base64url');
}
