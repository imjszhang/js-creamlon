import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessedIdsFromText, hasProcessed } from '../lib/dedup.mjs';
import { hashText } from '../lib/hash.mjs';
import { signProof, buildProofFields, generateKeyPair } from '../lib/proof.mjs';

test('loadProcessedIdsFromText extracts request_ids', async () => {
  const { privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-a',
    capabilityId: 'echo',
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const log = `# header\n\n${JSON.stringify(proof)}\n`;
  const ids = loadProcessedIdsFromText(log);
  assert.equal(ids.has('req-a'), true);
  assert.equal(hasProcessed(ids, 'req-a'), true);
  assert.equal(hasProcessed(ids, 'req-b'), false);
});
