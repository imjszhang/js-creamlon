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
import { parseAgentYaml } from '../lib/agentYaml.mjs';
import { hashText } from '../lib/hash.mjs';

test('canonicalPayload stable key order', () => {
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputHash: 'sha256:aa',
    outputHash: 'sha256:bb',
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const payload = canonicalPayload(fields);
  assert.equal(
    payload,
    '{"v":"0.1","request_id":"req-1","capability_id":"echo","input_hash":"sha256:aa","output_hash":"sha256:bb","completed_at":"2026-06-13T00:00:00.000Z"}',
  );
});

test('sign and verify roundtrip', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    capabilityId: 'echo',
    inputHash: hashText('hello'),
    outputHash: hashText('hello'),
    completedAt: '2026-06-13T10:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, true);
});

test('verify rejects tampered proof', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const inputHash = hashText('input');
  const outputHash = hashText('output');
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputHash,
    outputHash,
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  proof.output_hash = hashText('tampered');
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, false);
});

test('verify rejects unsupported protocol version', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  proof.v = '0.2';
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported protocol version/);
});

test('verify rejects invalid hash format', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-1',
    capabilityId: 'echo',
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  proof.input_hash = 'sha256:aa';
  const result = verifyProof(proof, publicKey);
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid input_hash/);
});

test('publicKey base64url roundtrip', async () => {
  const { publicKey, privateKey } = await generateKeyPair(null);
  const b64 = publicKeyToBase64Url(publicKey);
  const restored = publicKeyFromBase64Url(b64);
  const fields = buildProofFields({
    requestId: 'req-2',
    capabilityId: 'echo',
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  assert.equal(verifyProof(proof, restored).ok, true);
});

test('parseAgentYaml reads creamlon block', () => {
  const yaml = `name: demo-agent
description: Demo node
creamlon:
  version: "0.1"
  public_key: abc123
  capabilities:
    - id: echo
      description: Echo input
`;
  const parsed = parseAgentYaml(yaml);
  assert.equal(parsed.name, 'demo-agent');
  assert.equal(parsed.creamlon.version, '0.1');
  assert.equal(parsed.creamlon.public_key, 'abc123');
  assert.equal(parsed.creamlon.capabilities.length, 1);
  assert.equal(parsed.creamlon.capabilities[0].id, 'echo');
});
