import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashDigestError } from './hash.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';

export const PROOF_VERSION = PROTOCOL_VERSION;
const PROOF_KEYS = new Set([
  'version',
  'request_id',
  'capability_id',
  'input_digest',
  'output_digest',
  'completed_at',
  'credential_digest',
  'task_intent_digest',
  'signature',
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function canonicalPayload(fields) {
  const ordered = {
    version: fields.version,
    request_id: fields.request_id,
    capability_id: fields.capability_id,
    input_digest: fields.input_digest,
    output_digest: fields.output_digest,
    ...(fields.credential_digest ? { credential_digest: fields.credential_digest } : {}),
    ...(fields.task_intent_digest ? { task_intent_digest: fields.task_intent_digest } : {}),
    completed_at: fields.completed_at,
  };
  return JSON.stringify(ordered);
}

export function buildProofFields({
  requestId,
  capabilityId,
  inputDigest,
  outputDigest,
  credentialDigest = null,
  taskIntentDigest = null,
  completedAt = new Date().toISOString(),
}) {
  return {
    version: PROOF_VERSION,
    request_id: requestId,
    capability_id: capabilityId,
    input_digest: inputDigest,
    output_digest: outputDigest,
    ...(credentialDigest ? { credential_digest: credentialDigest } : {}),
    ...(taskIntentDigest ? { task_intent_digest: taskIntentDigest } : {}),
    completed_at: completedAt,
  };
}

function decodeBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function encodeBase64Url(buf) {
  return buf.toString('base64url');
}

export async function readPrivateKeyFile(keyPath) {
  const pem = await readFile(keyPath, 'utf8');
  return createPrivateKey(pem);
}

export async function readPublicKeyFromFile(keyPath) {
  const pem = await readFile(keyPath, 'utf8');
  return createPublicKey(pem);
}

export function publicKeyToBase64Url(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const raw = spki.subarray(spki.length - 32);
  return encodeBase64Url(raw);
}

export function publicKeyFromBase64Url(b64) {
  const raw = decodeBase64Url(b64);
  if (raw.length !== 32 || !/^[A-Za-z0-9_-]{43}$/.test(b64)) {
    throw new Error('invalid Ed25519 public key');
  }
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const spki = Buffer.concat([prefix, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

export function publicKeyFingerprint(publicKeyBase64Url) {
  const raw = decodeBase64Url(publicKeyBase64Url);
  if (raw.length !== 32 || !/^[A-Za-z0-9_-]{43}$/.test(publicKeyBase64Url)) {
    throw new Error('invalid Ed25519 public key');
  }
  return `sha256:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

export function signProof(fields, privateKey) {
  const payload = canonicalPayload(fields);
  const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey);
  return { ...fields, signature: encodeBase64Url(signature) };
}

export function verifyProof(proof, publicKey) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return { ok: false, reason: 'invalid proof: expected an object' };
  }
  const unknown = Object.keys(proof).filter((key) => !PROOF_KEYS.has(key));
  if (unknown.length) return { ok: false, reason: `unknown proof fields: ${unknown.join(', ')}` };
  const { signature, ...rest } = proof;
  if (!signature) return { ok: false, reason: 'missing signature' };
  const fields = {
    version: rest.version,
    request_id: rest.request_id,
    capability_id: rest.capability_id,
    input_digest: rest.input_digest,
    output_digest: rest.output_digest,
    ...(rest.credential_digest ? { credential_digest: rest.credential_digest } : {}),
    ...(rest.task_intent_digest ? { task_intent_digest: rest.task_intent_digest } : {}),
    completed_at: rest.completed_at,
  };
  if (fields.version !== PROOF_VERSION) {
    return { ok: false, reason: `unsupported protocol version: ${fields.version}` };
  }
  if (!ID_RE.test(fields.request_id || '')) return { ok: false, reason: 'invalid request_id' };
  if (!ID_RE.test(fields.capability_id || '')) return { ok: false, reason: 'invalid capability_id' };
  const inputErr = hashDigestError(fields.input_digest, 'input_digest');
  if (inputErr) return { ok: false, reason: inputErr };
  const outputErr = hashDigestError(fields.output_digest, 'output_digest');
  if (outputErr) return { ok: false, reason: outputErr };
  if (!!fields.credential_digest !== !!fields.task_intent_digest) {
    return { ok: false, reason: 'credential proof fields must appear together' };
  }
  if (fields.credential_digest) {
    const credentialErr = hashDigestError(fields.credential_digest, 'credential_digest');
    if (credentialErr) return { ok: false, reason: credentialErr };
    const intentErr = hashDigestError(fields.task_intent_digest, 'task_intent_digest');
    if (intentErr) return { ok: false, reason: intentErr };
  }
  if (!ISO_WITH_ZONE_RE.test(fields.completed_at || '') || Number.isNaN(Date.parse(fields.completed_at))) {
    return { ok: false, reason: 'invalid completed_at' };
  }
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    return { ok: false, reason: 'invalid signature encoding' };
  }
  const payload = canonicalPayload(fields);
  const sigBuf = decodeBase64Url(signature);
  const valid = verify(null, Buffer.from(payload, 'utf8'), publicKey, sigBuf);
  return valid ? { ok: true } : { ok: false, reason: 'invalid signature' };
}

export async function generateKeyPair(outDir) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubB64 = publicKeyToBase64Url(publicKey);

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'public.key'), pubPem, 'utf8');
    const privateKeyPath = join(outDir, 'private.key');
    await writeFile(privateKeyPath, privPem, { encoding: 'utf8', mode: 0o600 });
    await chmod(privateKeyPath, 0o600);
    await writeFile(join(outDir, 'public.b64url'), `${pubB64}\n`, 'utf8');
  }

  return { publicKey, privateKey, publicKeyBase64Url: pubB64, pubPem, privPem };
}

export function parseProofJson(text) {
  return JSON.parse(text);
}
