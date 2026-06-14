import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadHmacKeys,
  signHmacPayment,
  verifyHmacPayment,
} from '../lib/payment.mjs';
import { hashText } from '../lib/hash.mjs';

test('HMAC payment binds request, capability, input hash, and expiry', () => {
  const task = {
    request_id: 'req-hmac',
    capability_id: 'echo',
    input: 'hello',
    input_hash: null,
    input_ref: null,
  };
  const payment = signHmacPayment(task, {
    keyId: 'customer-1',
    secret: 'secret',
    expires: '2099-01-01T00:00:00Z',
  });
  const keys = new Map([['customer-1', 'secret']]);
  assert.equal(verifyHmacPayment(task, payment, keys).ok, true);
  assert.equal(verifyHmacPayment({ ...task, capability_id: 'review' }, payment, keys).ok, false);
  assert.equal(verifyHmacPayment({ ...task, input: null, input_hash: hashText('other') }, payment, keys).ok, false);
});

test('HMAC payment rejects expired credential', () => {
  const task = { request_id: 'r', capability_id: 'echo', input: 'x' };
  const payment = signHmacPayment(task, {
    keyId: 'k',
    secret: 's',
    expires: '2020-01-01T00:00:00Z',
  });
  const result = verifyHmacPayment(task, payment, new Map([['k', 's']]), new Date('2026-01-01'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired/);
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
