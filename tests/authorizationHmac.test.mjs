import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadHmacKeys,
  signHmacAuthorization,
  verifyHmacAuthorization,
} from '../lib/authorizationHmac.mjs';
import { hashText } from '../lib/hash.mjs';

test('HMAC authorization binds request, capability, input digest, and expiry', () => {
  const task = {
    version: '1',
    request_id: 'req-hmac',
    capability_id: 'echo',
    input: { media_type: 'text/plain', value: 'hello' },
  };
  const authorization = signHmacAuthorization(task, {
    keyId: 'customer-1',
    secret: 'secret',
    expires: '2099-01-01T00:00:00Z',
  });
  const keys = new Map([['customer-1', 'secret']]);
  assert.equal(verifyHmacAuthorization(task, authorization, keys).ok, true);
  assert.equal(verifyHmacAuthorization({ ...task, capability_id: 'review' }, authorization, keys).ok, false);
  assert.equal(verifyHmacAuthorization({
    ...task,
    input: { media_type: 'text/plain', digest: hashText('other') },
  }, authorization, keys).ok, false);
});

test('HMAC authorization rejects expired credential', () => {
  const task = {
    version: '1',
    request_id: 'r',
    capability_id: 'echo',
    input: { media_type: 'text/plain', value: 'x' },
  };
  const authorization = signHmacAuthorization(task, {
    keyId: 'k',
    secret: 's',
    expires: '2020-01-01T00:00:00Z',
  });
  const result = verifyHmacAuthorization(
    task,
    authorization,
    new Map([['k', 's']]),
    new Date('2026-01-01'),
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired/);
});

test('HMAC authorization binds the immutable delivery commit', () => {
  const task = {
    version: '1',
    request_id: 'req-delivery-hmac',
    capability_id: 'echo',
    input: { media_type: 'application/octet-stream', digest: hashText('input') },
    extensions: {
      delivery: {
        scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
        transport: 'github-private-repo',
        ephemeral_public_key: 'A'.repeat(43),
        github: {
          repo: 'github:alice/inbox',
          ref: 'main',
          input_path: 'tasks/req-delivery-hmac/input.enc',
          input_commit: 'a'.repeat(40),
          output_path: 'tasks/req-delivery-hmac/output.enc',
        },
      },
    },
  };
  const authorization = signHmacAuthorization(task, {
    keyId: 'customer-1',
    secret: 'secret',
    expires: '2099-01-01T00:00:00Z',
  });
  const tampered = structuredClone(task);
  tampered.extensions.delivery.github.input_commit = 'b'.repeat(40);
  assert.equal(
    verifyHmacAuthorization(
      tampered,
      authorization,
      new Map([['customer-1', 'secret']]),
    ).ok,
    false,
  );
});

test('loadHmacKeys reads the private key file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-keys-'));
  try {
    const filePath = join(dir, 'keys.json');
    await writeFile(filePath, '{"customer-1":"secret"}\n', 'utf8');
    const keys = await loadHmacKeys(filePath);
    assert.deepEqual(Object.fromEntries(keys), { 'customer-1': 'secret' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
