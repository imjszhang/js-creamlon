import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskAcceptance } from '../lib/acceptance.mjs';
import { signHmacPayment } from '../lib/payment.mjs';

const AGENT = {
  name: 'node',
  description: 'd',
  creamlon: {
    version: '0.3.1',
    public_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    status: 'available',
    payment_instructions: 'contact operator',
    capabilities: [{
      id: 'echo',
      description: 'echo',
      input_types: ['text/plain'],
      output_types: ['text/plain'],
    }],
  },
};

const BASE_TASK = {
  request_id: 'req-1',
  capability_id: 'echo',
  requester: 'github:a/b',
  input: 'hi',
  input_hash: null,
  input_ref: null,
  expires: null,
  payment: null,
};
BASE_TASK.payment = signHmacPayment(BASE_TASK, {
  keyId: 'customer-1',
  secret: 'secret',
  expires: '2099-01-01T00:00:00Z',
});

const OPTIONS = {
  agentParsed: AGENT,
  paymentSecrets: { hmacKeys: new Map([['customer-1', 'secret']]) },
  checkIssueMeta: true,
};

test('validateTaskAcceptance passes a valid task', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'open' }, {
    ...OPTIONS,
    processedIds: new Set(),
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.payment_ok, true);
});

test('validateTaskAcceptance rejects expired task', () => {
  const result = validateTaskAcceptance(
    { ...BASE_TASK, expires: '2020-01-01T00:00:00Z' },
    { title: '[task] echo', state: 'open' },
    OPTIONS,
  );
  assert.ok(result.errors.some((error) => error.includes('expired')));
});

test('validateTaskAcceptance rejects duplicate request_id', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'open' }, {
    ...OPTIONS,
    processedIds: new Set(['req-1']),
  });
  assert.ok(result.errors.some((error) => error.includes('duplicate')));
});

test('validateTaskAcceptance rejects a tampered payment', () => {
  const result = validateTaskAcceptance(
    { ...BASE_TASK, capability_id: 'review' },
    { title: '[task] review', state: 'open' },
    OPTIONS,
  );
  assert.equal(result.payment_ok, false);
  assert.ok(result.errors.some((error) => error.includes('invalid payment signature')));
});

test('validateTaskAcceptance rejects closed issue', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'closed' }, OPTIONS);
  assert.ok(result.errors.some((error) => error.includes('not open')));
});
