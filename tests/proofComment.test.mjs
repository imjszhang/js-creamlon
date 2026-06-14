import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProofFromCommentBody, extractProofFromComments } from '../lib/proofComment.mjs';
import { buildProofFields, signProof, generateKeyPair } from '../lib/proof.mjs';
import { hashText } from '../lib/hash.mjs';

test('extractProofFromCommentBody parses deliver comment format', async () => {
  const { privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-proof-1',
    capabilityId: 'echo',
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const body = `Creamlon delivery proof:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\``;
  const extracted = extractProofFromCommentBody(body);
  assert.equal(extracted.request_id, 'req-proof-1');
  assert.equal(extracted.sig, proof.sig);
});

test('extractProofFromComments returns latest proof comment', async () => {
  const { privateKey } = await generateKeyPair(null);
  const mkProof = (requestId) => {
    const fields = buildProofFields({
      requestId,
      capabilityId: 'echo',
      inputHash: hashText('in'),
      outputHash: hashText('out'),
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
