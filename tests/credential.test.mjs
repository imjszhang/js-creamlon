import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  authorizeCredential,
  credentialDigest,
  generateCredential,
  loadCredentialStore,
  parseCredential,
  taskIntentDigest,
  verifyCredentialAuthorization,
  validateRedemption,
  writeCredentialStore,
} from '../lib/credential.mjs';
import { parseManifest } from '../lib/manifest.mjs';
import { parseTask, serializeTask } from '../lib/task.mjs';
import { validateTaskAcceptance } from '../lib/acceptance.mjs';

const MANIFEST = parseManifest(`version: "1"
name: paid-node
identity:
  type: ed25519
  public_key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
status: available
capabilities:
  - id: review
    input:
      media_types: [text/plain]
    output:
      media_types: [text/markdown]
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

function task() {
  return parseTask(`version: "1"
request_id: req-paid-1
capability_id: review
requester: github:alice/caller
input:
  media_type: text/plain
  value: hello
expires: 2099-01-01T00:00:00Z
`);
}

test('credential format roundtrips and uses high-entropy secret', () => {
  const generated = generateCredential();
  const parsed = parseCredential(generated.value);
  assert.equal(parsed.credential_id, generated.credential_id);
  assert.equal(parsed.secret, generated.secret);
  assert.match(generated.value, /^crv1_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
});

test('credential authorization binds node, task, input, capability, and expiry', () => {
  const generated = generateCredential();
  const current = task();
  current.credential = authorizeCredential(current, MANIFEST, generated.value);
  const record = {
    credential_id: generated.credential_id,
    secret: generated.secret,
    capability_id: 'review',
    status: 'available',
  };
  const valid = verifyCredentialAuthorization(current, MANIFEST, current.credential, record);
  assert.equal(valid.ok, true);
  assert.equal(valid.credential_digest, credentialDigest(generated.credential_id, generated.secret));
  assert.equal(valid.task_intent_digest, taskIntentDigest(current, MANIFEST, generated.credential_id));

  for (const mutate of [
    (value) => { value.request_id = 'other-request'; },
    (value) => { value.capability_id = 'other'; },
    (value) => { value.input.value = 'tampered'; },
    (value) => { value.expires = '2098-01-01T00:00:00Z'; },
  ]) {
    const changed = structuredClone(current);
    mutate(changed);
    assert.equal(
      verifyCredentialAuthorization(changed, MANIFEST, changed.credential, record).ok,
      false,
    );
  }

  const otherManifest = structuredClone(MANIFEST);
  otherManifest.identity.public_key = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  assert.equal(
    verifyCredentialAuthorization(current, otherManifest, current.credential, record).ok,
    false,
  );
});

test('public task serialization never includes the credential secret', () => {
  const generated = generateCredential();
  const current = task();
  current.credential = authorizeCredential(current, MANIFEST, generated.value);
  const text = serializeTask(current);
  assert.match(text, new RegExp(generated.credential_id));
  assert.doesNotMatch(text, new RegExp(generated.secret));
  assert.equal(parseTask(text).credential.scheme, 'voucher-hmac-v1');
});

test('acceptance enforces credential policy and redemption uniqueness', () => {
  const generated = generateCredential();
  const current = task();
  current.credential = authorizeCredential(current, MANIFEST, generated.value);
  const credentialStore = {
    version: '1',
    credentials: [{
      credential_id: generated.credential_id,
      secret: generated.secret,
      capability_id: 'review',
      status: 'available',
    }],
  };
  const issue = { title: '[task] review', state: 'open' };
  const accepted = validateTaskAcceptance(current, issue, {
    manifest: MANIFEST,
    credentialStore,
    checkIssueMeta: true,
  });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.credential_ok, true);

  const reused = validateTaskAcceptance(
    { ...current, request_id: 'req-paid-2' },
    issue,
    {
      manifest: MANIFEST,
      credentialStore,
      redemptions: [{
        credential_id: generated.credential_id,
        request_id: 'req-paid-1',
      }],
      checkIssueMeta: true,
    },
  );
  assert.ok(reused.errors.some((error) => (
    error.includes('invalid credential authorization') || error.includes('already redeemed')
  )));
});

test('credential store persists privately and validates records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-credentials-'));
  const path = join(dir, '.creamlon', 'credentials.json');
  const generated = generateCredential();
  const store = {
    version: '1',
    credentials: [{
      credential_id: generated.credential_id,
      secret: generated.secret,
      capability_id: 'review',
      status: 'available',
      created_at: '2026-06-14T00:00:00Z',
      expires: null,
    }],
  };
  try {
    await writeCredentialStore(path, store);
    assert.deepEqual(await loadCredentialStore(path), store);
    const stat = await import('node:fs/promises').then((fs) => fs.stat(path));
    assert.equal(stat.mode & 0o077, 0);
    assert.match(await readFile(path, 'utf8'), new RegExp(generated.secret));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expired, revoked, and capability-mismatched credentials are rejected', () => {
  const generated = generateCredential();
  const current = task();
  current.credential = authorizeCredential(current, MANIFEST, generated.value);
  const base = {
    credential_id: generated.credential_id,
    secret: generated.secret,
    capability_id: 'review',
    status: 'available',
  };
  assert.equal(verifyCredentialAuthorization(current, MANIFEST, {
    ...current.credential,
  }, { ...base, status: 'revoked' }).reason, 'credential revoked');
  assert.equal(verifyCredentialAuthorization(current, MANIFEST, current.credential, {
    ...base,
    expires: '2020-01-01T00:00:00Z',
  }).reason, 'credential expired');
  assert.equal(verifyCredentialAuthorization(current, MANIFEST, current.credential, {
    ...base,
    capability_id: 'translate',
  }).reason, 'credential capability mismatch');
});

test('redemption records use strict version 1 digests and timestamps', () => {
  const valid = {
    version: '1',
    request_id: 'req-1',
    credential_id: 'ABCDEFGH',
    credential_digest: `sha256:${'a'.repeat(64)}`,
    task_intent_digest: `sha256:${'b'.repeat(64)}`,
    capability_id: 'review',
    redeemed_at: '2026-06-14T00:00:00Z',
  };
  assert.deepEqual(validateRedemption(valid), []);
  assert.ok(validateRedemption({
    ...valid,
    version: '2',
    credential_digest: 'bad',
    redeemed_at: 'never',
  }).length >= 3);
});
