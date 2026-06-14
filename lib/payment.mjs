import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveInputHash } from './taskYaml.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function secureCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function canonicalPaymentPayload(task, payment) {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    key_id: payment.key_id,
    request_id: task.request_id,
    capability_id: task.capability_id,
    input_hash: resolveInputHash(task),
    expires: payment.expires,
  });
}

export function signHmacPayment(task, { keyId, secret, expires }) {
  const payment = {
    key_id: keyId,
    expires,
  };
  const payload = canonicalPaymentPayload(task, payment);
  payment.signature = createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
  return payment;
}

export function verifyHmacPayment(task, payment, keys, now = new Date()) {
  if (!payment) return { ok: false, reason: 'missing payment' };
  if (!payment.key_id) return { ok: false, reason: 'missing payment.key_id' };
  if (!payment.expires) return { ok: false, reason: 'missing payment.expires' };
  if (!payment.signature) return { ok: false, reason: 'missing payment.signature' };
  const expiresAt = Date.parse(payment.expires);
  if (Number.isNaN(expiresAt)) return { ok: false, reason: 'invalid payment.expires' };
  if (expiresAt < now.getTime()) return { ok: false, reason: 'payment expired' };
  const secret = keys?.get(payment.key_id);
  if (!secret) return { ok: false, reason: `unknown payment.key_id: ${payment.key_id}` };
  const expected = signHmacPayment(task, {
    keyId: payment.key_id,
    secret,
    expires: payment.expires,
  }).signature;
  return secureCompare(payment.signature, expected)
    ? { ok: true, reason: null }
    : { ok: false, reason: 'invalid payment signature' };
}

export async function loadHmacKeys(filePath) {
  const keys = new Map();

  if (filePath) {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      for (const [keyId, secret] of Object.entries(parsed)) keys.set(keyId, String(secret));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return keys;
}

export function generateHmacSecret(bytes) {
  return encodeBase64Url(bytes);
}
