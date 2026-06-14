import { sign, verify } from 'node:crypto';
import { PROTOCOL_VERSION } from './protocol.mjs';
import { publicKeyFromBase64Url } from './proof.mjs';

const ROTATION_KEYS = new Set(['v', 'old_public_key', 'new_public_key', 'rotated_at', 'sig']);

export function canonicalRotation(rotation) {
  return JSON.stringify({
    v: rotation.v,
    old_public_key: rotation.old_public_key,
    new_public_key: rotation.new_public_key,
    rotated_at: rotation.rotated_at,
  });
}

export function signKeyRotation({ oldPublicKey, newPublicKey, rotatedAt = new Date().toISOString() }, oldPrivateKey) {
  publicKeyFromBase64Url(oldPublicKey);
  publicKeyFromBase64Url(newPublicKey);
  if (Number.isNaN(Date.parse(rotatedAt))) throw new Error('invalid rotation timestamp');
  const fields = {
    v: PROTOCOL_VERSION,
    old_public_key: oldPublicKey,
    new_public_key: newPublicKey,
    rotated_at: rotatedAt,
  };
  const sig = sign(
    null,
    Buffer.from(canonicalRotation(fields), 'utf8'),
    oldPrivateKey,
  ).toString('base64url');
  return { ...fields, sig };
}

export function verifyKeyContinuity(text, currentPublicKey) {
  if (!text?.trim()) return { status: 'unverified', rotations: 0, errors: [] };
  const errors = [];
  const rotations = [];
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      rotations.push(JSON.parse(trimmed));
    } catch {
      errors.push(`line ${index + 1}: invalid JSON`);
    }
  }
  for (let i = 0; i < rotations.length; i += 1) {
    const item = rotations[i];
    const unknown = item && typeof item === 'object'
      ? Object.keys(item).filter((key) => !ROTATION_KEYS.has(key))
      : [];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`rotation ${i + 1}: expected an object`);
      continue;
    }
    if (item.v !== PROTOCOL_VERSION) errors.push(`rotation ${i + 1}: invalid version`);
    if (unknown.length) errors.push(`rotation ${i + 1}: unknown fields`);
    if (item.old_public_key === item.new_public_key) errors.push(`rotation ${i + 1}: keys must differ`);
    if (Number.isNaN(Date.parse(item.rotated_at))) errors.push(`rotation ${i + 1}: invalid timestamp`);
    if (i > 0 && Date.parse(item.rotated_at) <= Date.parse(rotations[i - 1].rotated_at)) {
      errors.push(`rotation ${i + 1}: timestamps not increasing`);
    }
    if (i > 0 && item.old_public_key !== rotations[i - 1].new_public_key) {
      errors.push(`rotation ${i + 1}: chain broken`);
    }
    try {
      const ok = verify(
        null,
        Buffer.from(canonicalRotation(item), 'utf8'),
        publicKeyFromBase64Url(item.old_public_key),
        Buffer.from(item.sig || '', 'base64url'),
      );
      if (!ok) errors.push(`rotation ${i + 1}: invalid signature`);
    } catch {
      errors.push(`rotation ${i + 1}: invalid key or signature`);
    }
  }
  if (rotations.length && rotations.at(-1).new_public_key !== currentPublicKey) {
    errors.push('rotation chain does not end at current public key');
  }
  return {
    status: errors.length ? 'broken' : 'verified',
    rotations: rotations.length,
    errors,
  };
}
