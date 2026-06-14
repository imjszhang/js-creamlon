import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_SCHEME,
  LEGACY_DELIVERY_SCHEME,
  generateDeliveryKeyPair,
  seal,
  open,
} from '../lib/extensions/delivery/hpke.mjs';

test('delivery hpke roundtrips plaintext', () => {
  const alice = generateDeliveryKeyPair();
  const payload = Buffer.from('private review content', 'utf8');
  const sealed = seal(payload, alice.public_key);
  assert.equal(JSON.parse(sealed).scheme, DELIVERY_SCHEME);
  const opened = open(sealed, alice.private_key);
  assert.equal(opened.toString('utf8'), payload.toString('utf8'));
});

test('delivery decrypts legacy version 1 ciphertexts', () => {
  const alice = generateDeliveryKeyPair();
  const sealed = seal('legacy', alice.public_key, LEGACY_DELIVERY_SCHEME);
  assert.equal(open(sealed, alice.private_key).toString('utf8'), 'legacy');
});

test('delivery rejects unsupported envelope versions and malformed nonces', () => {
  const alice = generateDeliveryKeyPair();
  const sealed = JSON.parse(seal('hello', alice.public_key));
  assert.throws(() => open({ ...sealed, version: 2 }, alice.private_key));
  assert.throws(() => open({ ...sealed, iv: 'AA' }, alice.private_key));
});

test('delivery hpke rejects tampered ciphertext', () => {
  const alice = generateDeliveryKeyPair();
  const sealed = JSON.parse(seal('hello', alice.public_key));
  const bytes = Buffer.from(sealed.ciphertext, 'base64url');
  bytes[0] ^= 0xff;
  sealed.ciphertext = bytes.toString('base64url');
  assert.throws(() => open(sealed, alice.private_key));
});

test('delivery hpke rejects wrong private key', () => {
  const alice = generateDeliveryKeyPair();
  const bob = generateDeliveryKeyPair();
  const sealed = seal('hello', alice.public_key);
  assert.throws(() => open(sealed, bob.private_key));
});
