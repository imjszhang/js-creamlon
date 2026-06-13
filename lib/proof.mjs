import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashDigestError } from './hash.mjs';

export const PROOF_VERSION = '0.1';

export function canonicalPayload(fields) {
  const ordered = {
    v: fields.v,
    request_id: fields.request_id,
    capability_id: fields.capability_id,
    input_hash: fields.input_hash,
    output_hash: fields.output_hash,
    completed_at: fields.completed_at,
  };
  return JSON.stringify(ordered);
}

export function buildProofFields({
  requestId,
  capabilityId,
  inputHash,
  outputHash,
  completedAt = new Date().toISOString(),
}) {
  return {
    v: PROOF_VERSION,
    request_id: requestId,
    capability_id: capabilityId,
    input_hash: inputHash,
    output_hash: outputHash,
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
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const spki = Buffer.concat([prefix, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

export function signProof(fields, privateKey) {
  const payload = canonicalPayload(fields);
  const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey);
  return { ...fields, sig: encodeBase64Url(sig) };
}

export function verifyProof(proof, publicKey) {
  const { sig, ...rest } = proof;
  if (!sig) return { ok: false, reason: 'missing sig' };
  const fields = {
    v: rest.v,
    request_id: rest.request_id,
    capability_id: rest.capability_id,
    input_hash: rest.input_hash,
    output_hash: rest.output_hash,
    completed_at: rest.completed_at,
  };
  if (fields.v !== PROOF_VERSION) {
    return { ok: false, reason: `unsupported protocol version: ${fields.v}` };
  }
  const inputErr = hashDigestError(fields.input_hash, 'input_hash');
  if (inputErr) return { ok: false, reason: inputErr };
  const outputErr = hashDigestError(fields.output_hash, 'output_hash');
  if (outputErr) return { ok: false, reason: outputErr };
  const payload = canonicalPayload(fields);
  const sigBuf = decodeBase64Url(sig);
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
    await writeFile(join(outDir, 'private.key'), privPem, 'utf8');
    await writeFile(join(outDir, 'public.b64url'), `${pubB64}\n`, 'utf8');
  }

  return { publicKey, privateKey, publicKeyBase64Url: pubB64, pubPem, privPem };
}

export function parseProofJson(text) {
  return JSON.parse(text);
}
