import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalPayload,
  buildProofFields,
  signProof,
  verifyProof,
  generateKeyPair,
  publicKeyToBase64Url,
  publicKeyFromBase64Url,
} from '../lib/proof.mjs';
import { hashText } from '../lib/hash.mjs';

test('canonicalPayload stable key order', () => {
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputDigest: 'sha256:aa',
    outputDigest: 'sha256:bb',
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const payload = canonicalPayload(fields);
  assert.equal(
    payload,
    '{"version":"1","request_id":"req-1","capability_id":"echo","input_digest":"sha256:aa","output_digest":"sha256:bb","completed_at":"2026-06-13T00:00:00.000Z"}',
  );
});

test('sign and verify roundtrip', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    capabilityId: 'echo',
    inputDigest: hashText('hello'),
    outputDigest: hashText('hello'),
    completedAt: '2026-06-13T10:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, true);
});

test('verify rejects tampered proof', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const inputDigest = hashText('input');
  const outputDigest = hashText('output');
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputDigest,
    outputDigest,
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  proof.output_digest = hashText('tampered');
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, false);
});

test('verify rejects unsupported protocol version', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  proof.version = '2';
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported protocol version/);
});

test('verify rejects unknown proof fields and malformed identifiers', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  assert.match(verifyProof({ ...proof, extra: true }, publicKey).reason, /unknown proof fields/);
  assert.match(verifyProof({ ...proof, request_id: 'bad id' }, publicKey).reason, /invalid request_id/);
});

test('verify rejects invalid hash format', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  proof.input_digest = 'sha256:aa';
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid input_digest/);
});

test('verify rejects an invalid completion timestamp', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-time',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: 'not-a-date',
  });
  const proof = signProof(fields, privateKey);
  assert.match(verifyProof(proof, publicKey).reason, /invalid completed_at/);
});

test('publicKey base64url roundtrip', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const b64 = publicKeyToBase64Url(publicKey);
  const restored = publicKeyFromBase64Url(b64);
  const fields = buildProofFields({
    requestId: 'req-2',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  assert.equal(verifyProof(proof, restored).ok, true);
});

test('credential proof fields are optional but signed together', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const credentialDigest = hashText('credential');
  const taskIntentDigest = hashText('intent');
  const proof = signProof(buildProofFields({
    requestId: 'req-credential',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    credentialDigest,
    taskIntentDigest,
    completedAt: '2026-06-13T00:00:00.000Z',
  }), privateKey);
  assert.equal(verifyProof(proof, publicKey).ok, true);
  assert.equal(proof.credential_digest, credentialDigest);
  assert.equal(proof.task_intent_digest, taskIntentDigest);
  assert.equal(verifyProof({ ...proof, task_intent_digest: hashText('tampered') }, publicKey).ok, false);
  const { task_intent_digest: _removed, ...incomplete } = proof;
  assert.match(verifyProof(incomplete, publicKey).reason, /must appear together/);
});
