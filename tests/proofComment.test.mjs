import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBoundProofFromComments,
  extractProofFromCommentBody,
  extractProofFromComments,
} from '../lib/proofComment.mjs';
import { buildProofFields, signProof, generateKeyPair } from '../lib/proof.mjs';
import { hashText } from '../lib/hash.mjs';
import { generateCredential, authorizeCredential, taskIntentDigest } from '../lib/credential.mjs';
import { parseManifest } from '../lib/manifest.mjs';

test('extractProofFromCommentBody parses deliver comment format', async () => {
  const { privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-proof-1',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const body = `Creamlon delivery proof:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\``;
  const extracted = extractProofFromCommentBody(body);
  assert.equal(extracted.request_id, 'req-proof-1');
  assert.equal(extracted.signature, proof.signature);
});

test('extractProofFromComments returns latest proof comment', async () => {
  const { privateKey } = await generateKeyPair(null);
  const mkProof = (requestId) => {
    const fields = buildProofFields({
      requestId,
      capabilityId: 'echo',
      inputDigest: hashText('in'),
      outputDigest: hashText('out'),
      completedAt: '2026-06-13T00:00:00.000Z',
    });
    return signProof(fields, privateKey);
  };

  const proof1 = mkProof('req-old');
  const proof2 = mkProof('req-new');
  const comments = [
    {
      created_at: '2026-06-13T10:00:00Z',
      body: `\`\`\`json\n${JSON.stringify(proof1)}\n\`\`\``,
    },
    {
      created_at: '2026-06-13T11:00:00Z',
      body: `\`\`\`json\n${JSON.stringify(proof2)}\n\`\`\``,
    },
  ];

  const extracted = extractProofFromComments(comments);
  assert.equal(extracted.request_id, 'req-new');
});

test('extractProofFromComments returns null when no proof', () => {
  assert.equal(extractProofFromComments([{ body: 'no proof here' }]), null);
});

test('extractBoundProofFromComments rejects cross-issue replay and untrusted author', async () => {
  const { privateKey } = await generateKeyPair(null);
  const proof = signProof(buildProofFields({
    requestId: 'other-request',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  }), privateKey);
  const body = `\`\`\`json\n${JSON.stringify(proof)}\n\`\`\``;
  const task = { request_id: 'expected', capability_id: 'echo' };
  const replay = extractBoundProofFromComments(
    [{ id: 1, author_association: 'OWNER', body }],
    task,
    hashText('in'),
  );
  assert.equal(replay.proof, null);
  assert.ok(replay.errors.some((error) => error.includes('request_id')));

  const matching = { ...proof, request_id: 'expected' };
  const untrusted = extractBoundProofFromComments(
    [{ id: 2, author_association: 'NONE', body: `\`\`\`json\n${JSON.stringify(matching)}\n\`\`\`` }],
    task,
    hashText('in'),
  );
  assert.equal(untrusted.proof, null);
  assert.ok(untrusted.errors.some((error) => error.includes('untrusted')));
});

test('credential proof binding verifies the public task intent digest', async () => {
  const { privateKey } = await generateKeyPair(null);
  const manifest = parseManifest(`version: "1"
name: node
identity:
  type: ed25519
  public_key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
status: available
capabilities:
  - id: echo
    input:
      media_types: [text/plain]
    output:
      media_types: [text/plain]
    access:
      mode: credential
      units: 1
profiles:
  github:
    transport: issues
  credential:
    scheme: voucher-hmac-v1
extensions: {}
`);
  const credential = generateCredential();
  const task = {
    version: '1',
    request_id: 'req-bound-credential',
    capability_id: 'echo',
    requester: 'github:a/b',
    input: { media_type: 'text/plain', value: 'hello' },
    expires: '2099-01-01T00:00:00Z',
  };
  task.credential = authorizeCredential(task, manifest, credential.value);
  const proof = signProof(buildProofFields({
    requestId: task.request_id,
    capabilityId: task.capability_id,
    inputDigest: hashText('hello'),
    outputDigest: hashText('out'),
    credentialDigest: hashText(credential.value),
    taskIntentDigest: taskIntentDigest(task, manifest, credential.credential_id),
    completedAt: '2026-06-13T00:00:00.000Z',
  }), privateKey);
  const body = `\`\`\`json\n${JSON.stringify(proof)}\n\`\`\``;
  const result = extractBoundProofFromComments(
    [{ id: 3, author_association: 'OWNER', body }],
    task,
    hashText('hello'),
    { manifest },
  );
  assert.equal(result.proof.request_id, task.request_id);

  const tampered = {
    ...proof,
    task_intent_digest: hashText('wrong'),
  };
  const rejected = extractBoundProofFromComments(
    [{ id: 4, author_association: 'OWNER', body: `\`\`\`json\n${JSON.stringify(tampered)}\n\`\`\`` }],
    task,
    hashText('hello'),
    { manifest },
  );
  assert.equal(rejected.proof, null);
  assert.ok(rejected.errors.some((error) => error.includes('task_intent_digest')));
});
