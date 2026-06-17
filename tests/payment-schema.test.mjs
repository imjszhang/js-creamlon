import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../lib/manifest.mjs';
import {
  parseManifestPayment,
  resolvePaymentProviders,
} from '../lib/extensions/payment/schema.mjs';

const YAML = `version: "1"
name: paid-agent
description: Paid node
identity:
  type: ed25519
  public_key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
status: available
capabilities:
  - id: code_review
    description: Review code
    input:
      media_types: [text/plain]
    output:
      media_types: [text/markdown]
    access:
      mode: credential
      units: 1
  - id: echo
    description: Echo text
    input:
      media_types: [text/plain]
    output:
      media_types: [text/plain]
    access:
      mode: credential
      units: 1
profiles:
  github:
    transport: issues
  credential:
    scheme: voucher-hmac-v1
extensions:
  payment:
    pattern: payment-bridge-v1
    instructions: Pay to receive a one-time credential.
    providers:
      - id: x402
        capability_id: code_review
        resource_url: https://pay.example/buy/code_review
        price: "2.00"
      - id: x402
        capability_id: echo
        resource_url: https://pay.example/buy/echo
        price: "0.50"
      - id: stripe
        checkout_url: https://shop.example/checkout
`;

test('parseManifestPayment reads provider hints without changing core manifest parsing', () => {
  const manifest = parseManifest(YAML);
  const payment = parseManifestPayment(manifest);
  assert.equal(payment.pattern, 'payment-bridge-v1');
  assert.equal(payment.instructions, 'Pay to receive a one-time credential.');
  assert.equal(payment.providers.length, 3);
  assert.deepEqual(payment.providers.map((provider) => provider.id), ['x402', 'x402', 'stripe']);
});

test('resolvePaymentProviders prefers exact capability matches', () => {
  const manifest = parseManifest(YAML);
  const providers = resolvePaymentProviders(manifest, 'code_review');
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'x402');
  assert.equal(providers[0].capability_id, 'code_review');
  assert.equal(providers[0].price, '2.00');
});

test('resolvePaymentProviders returns all providers for the requested capability', () => {
  const manifest = parseManifest(YAML.replace(
    '      - id: stripe\n        checkout_url: https://shop.example/checkout',
    `      - id: stripe
        capability_id: echo
        checkout_url: https://shop.example/checkout`,
  ));
  const providers = resolvePaymentProviders(manifest, 'echo');
  assert.deepEqual(providers.map((provider) => provider.id), ['x402', 'stripe']);
});

test('resolvePaymentProviders falls back to node-level providers', () => {
  const manifest = parseManifest(YAML);
  const providers = resolvePaymentProviders(manifest, 'summarize');
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'stripe');
  assert.equal(providers[0].capability_id, null);
});

test('payment helpers handle absent or malformed payment extensions', () => {
  assert.equal(parseManifestPayment({ extensions: {} }), null);
  assert.equal(parseManifestPayment({ extensions: { payment: [] } }), null);
  assert.deepEqual(resolvePaymentProviders({ extensions: {} }, 'echo'), []);
  assert.deepEqual(
    parseManifestPayment({ extensions: { payment: { providers: 'x402' } } }).providers,
    [],
  );
});
