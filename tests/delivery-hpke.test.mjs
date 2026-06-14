import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDeliveryKeyPair, seal, open } from '../lib/extensions/delivery/hpke.mjs';

test('delivery hpke roundtrips plaintext', () => {
  const alice = generateDeliveryKeyPair();
  const payload = Buffer.from('private review content', 'utf8');
  const sealed = seal(payload, alice.public_key);
  const opened = open(sealed, alice.private_key);
  assert.equal(opened.toString('utf8'), payload.toString('utf8'));
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
