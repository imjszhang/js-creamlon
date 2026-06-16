import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, validateManifest } from '../lib/manifest.mjs';
import { parseTask, validateTask } from '../lib/task.mjs';
import { canonicalPayload, buildProofFields } from '../lib/proof.mjs';
import { canonicalAuthorizationPayload } from '../lib/authorizationHmac.mjs';
import { parseProofsLog } from '../lib/proofsLog.mjs';
import { parseRedemptionsLog } from '../lib/credential.mjs';
import { hashText } from '../lib/hash.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'protocol-v1');

async function fixture(name) {
  return readFile(join(FIXTURES, name), 'utf8');
}

test('protocol v1 fixture manifest remains valid with third-party extension namespace', async () => {
  const manifest = parseManifest(await fixture('manifest-free.yaml'));
  assert.deepEqual(validateManifest(manifest, { requireGithubProfile: true }), []);
  assert.equal(manifest.extensions['com.example.note'].scheme, 'com.example.note-v1');
});

test('protocol v1 fixture task remains valid with third-party extension namespace', async () => {
  const task = parseTask(await fixture('task-free.yaml'));
  assert.deepEqual(validateTask(task, { capability_ids: ['echo'] }), []);
  assert.equal(task.extensions['com.example.note'].scheme, 'com.example.note-v1');
});

test('protocol v1 proof canonical payload bytes remain stable', async () => {
  const fields = buildProofFields({
    requestId: 'req-fixture-1',
    capabilityId: 'echo',
    inputDigest: hashText('hello'),
    outputDigest: hashText('hello'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  assert.equal(canonicalPayload(fields), (await fixture('proof-free-payload.txt')).trim());
});

test('protocol v1 authorization canonical payload bytes remain stable', async () => {
  const task = parseTask(await fixture('task-free.yaml'));
  const payload = canonicalAuthorizationPayload(task, {
    scheme: 'hmac-sha256',
    key_id: 'customer-1',
    expires: '2026-12-31T00:00:00Z',
  });
  assert.equal(payload, (await fixture('authorization-payload.txt')).trim());
});

test('protocol v1 trust logs remain newline-delimited JSON with comments', async () => {
  const proofs = parseProofsLog(await fixture('proofs.log'));
  const redemptions = parseRedemptionsLog(await fixture('redemptions.log'));
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].request_id, 'req-fixture-1');
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].credential_id, 'CRED1234');
});
