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
import { canonicalCredentialIntent, credentialDigest, parseRedemptionsLog } from '../lib/credential.mjs';
import {
  canonicalDeliveryIntent,
  deliveryIntentDigest,
  validateTaskDelivery,
} from '../lib/extensions/delivery/schema.mjs';
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

test('protocol v1 credential intent canonical payload bytes remain stable', async () => {
  const manifest = parseManifest(await fixture('manifest-free.yaml'));
  const task = parseTask(await fixture('task-credential.yaml'));
  assert.deepEqual(validateTask(task, {
    capability_ids: ['echo'],
    credential_required: true,
  }), []);
  assert.equal(
    canonicalCredentialIntent(task, manifest, 'CRED1234'),
    (await fixture('credential-intent-payload.txt')).trim(),
  );
});

test('protocol v1 delivery intent canonical payload bytes remain stable', async () => {
  const githubTask = parseTask(await fixture('task-delivery-github.yaml'));
  const presignedTask = parseTask(await fixture('task-delivery-presigned.yaml'));
  assert.deepEqual(validateTaskDelivery(githubTask.extensions.delivery, {
    requestId: githubTask.request_id,
  }), []);
  assert.deepEqual(validateTaskDelivery(presignedTask.extensions.delivery, {
    requestId: presignedTask.request_id,
  }), []);
  assert.equal(
    canonicalDeliveryIntent(githubTask),
    (await fixture('delivery-intent-github-payload.txt')).trim(),
  );
  assert.equal(
    canonicalDeliveryIntent(presignedTask),
    (await fixture('delivery-intent-presigned-payload.txt')).trim(),
  );
});

test('protocol v1 delivery proof canonical payload bytes remain stable', async () => {
  const task = parseTask(await fixture('task-delivery-github.yaml'));
  const fields = buildProofFields({
    requestId: task.request_id,
    capabilityId: task.capability_id,
    inputDigest: task.input.digest,
    outputDigest: `sha256:${'3'.repeat(64)}`,
    deliveryIntentDigest: deliveryIntentDigest(task),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  assert.equal(canonicalPayload(fields), (await fixture('proof-delivery-payload.txt')).trim());
});

test('protocol v1 credential proof canonical payload bytes remain stable', async () => {
  const manifest = parseManifest(await fixture('manifest-free.yaml'));
  const task = parseTask(await fixture('task-credential.yaml'));
  const credentialSecret = 'A'.repeat(43);
  const credentialIntent = canonicalCredentialIntent(task, manifest, 'CRED1234');
  const fields = buildProofFields({
    requestId: task.request_id,
    capabilityId: task.capability_id,
    inputDigest: hashText('hello'),
    outputDigest: hashText('hello'),
    credentialDigest: credentialDigest('CRED1234', credentialSecret),
    taskIntentDigest: hashText(credentialIntent),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  assert.equal(canonicalPayload(fields), (await fixture('proof-credential-payload.txt')).trim());
});

test('protocol v1 trust logs remain newline-delimited JSON with comments', async () => {
  const proofs = parseProofsLog(await fixture('proofs.log'));
  const redemptions = parseRedemptionsLog(await fixture('redemptions.log'));
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].request_id, 'req-fixture-1');
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].credential_id, 'CRED1234');
});

test('protocol v1 status trust file remains a single stable JSON object', async () => {
  const status = JSON.parse(await fixture('status.json'));
  assert.deepEqual(Object.keys(status), ['version', 'status', 'checked_at', 'proofs_valid']);
  assert.equal(status.version, '1');
  assert.ok(['available', 'busy', 'offline'].includes(status.status));
  assert.equal(Number.isNaN(Date.parse(status.checked_at)), false);
  assert.equal(typeof status.proofs_valid, 'boolean');
});
