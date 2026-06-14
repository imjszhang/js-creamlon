import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskAcceptance } from '../lib/acceptance.mjs';
import { signHmacAuthorization } from '../lib/authorizationHmac.mjs';
import { parseManifest } from '../lib/manifest.mjs';
import { parseTask } from '../lib/task.mjs';

const MANIFEST = parseManifest(`---
version: "1"
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
profiles:
  github:
    transport: issues
  authorization:
    scheme: hmac-sha256
extensions: {}
---
`);

const BASE_TASK = parseTask(`version: "1"
request_id: req-1
capability_id: echo
requester: github:a/b
input:
  media_type: text/plain
  value: hi
`);
BASE_TASK.authorization = signHmacAuthorization(BASE_TASK, {
  keyId: 'customer-1',
  secret: 'secret',
  expires: '2099-01-01T00:00:00Z',
});

const OPTIONS = {
  manifest: MANIFEST,
  authorizationSecrets: { hmacKeys: new Map([['customer-1', 'secret']]) },
  checkIssueMeta: true,
};

test('acceptance passes a valid authorized task', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'open' }, OPTIONS);
  assert.deepEqual(result.errors, []);
  assert.equal(result.authorization_ok, true);
});

test('acceptance supports free nodes', () => {
  const freeManifest = structuredClone(MANIFEST);
  freeManifest.profiles.authorization = null;
  const task = { ...BASE_TASK, authorization: null };
  const result = validateTaskAcceptance(task, { title: '[task] echo', state: 'open' }, {
    manifest: freeManifest,
    checkIssueMeta: true,
  });
  assert.deepEqual(result.errors, []);
});

test('acceptance rejects expiry, duplicates, tampering, and closed issues', () => {
  assert.ok(validateTaskAcceptance(
    { ...BASE_TASK, expires: '2020-01-01T00:00:00Z' },
    { title: '[task] echo', state: 'open' },
    OPTIONS,
  ).errors.some((error) => error.includes('expired')));
  assert.ok(validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'open' }, {
    ...OPTIONS,
    processedIds: new Set(['req-1']),
  }).errors.some((error) => error.includes('duplicate')));
  assert.ok(validateTaskAcceptance(
    { ...BASE_TASK, capability_id: 'review' },
    { title: '[task] review', state: 'open' },
    OPTIONS,
  ).errors.some((error) => error.includes('invalid authorization signature')));
  assert.ok(validateTaskAcceptance(
    BASE_TASK,
    { title: '[task] echo', state: 'closed' },
    OPTIONS,
  ).errors.some((error) => error.includes('not open')));
});
