import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskAcceptance } from '../lib/acceptance.mjs';

const AGENT = {
  name: 'node',
  description: 'd',
  creamlon: {
    version: '0.3',
    public_key: 'dGVzdA',
    payment_required: true,
    payment_instructions: 'get token',
    payment: { type: 'token' },
    capabilities: [{ id: 'echo', description: 'echo' }],
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
  payment: {
    type: 'token',
    token: 'good-token',
    request_id: 'req-1',
  },
};

test('validateTaskAcceptance passes valid paid task', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'open' }, {
    agentParsed: AGENT,
    processedIds: new Set(),
    paymentSecrets: { tokens: new Set(['good-token']) },
    checkIssueMeta: true,
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.payment_ok, true);
});

test('validateTaskAcceptance rejects expired task', () => {
  const task = {
    ...BASE_TASK,
    expires: '2020-01-01T00:00:00Z',
  };
  const result = validateTaskAcceptance(task, { title: '[task] echo', state: 'open' }, {
    agentParsed: AGENT,
    paymentSecrets: { tokens: new Set(['good-token']) },
    checkIssueMeta: true,
  });
  assert.ok(result.errors.some((e) => e.includes('expired')));
});

test('validateTaskAcceptance rejects duplicate request_id', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'open' }, {
    agentParsed: AGENT,
    processedIds: new Set(['req-1']),
    paymentSecrets: { tokens: new Set(['good-token']) },
    checkIssueMeta: true,
  });
  assert.ok(result.errors.some((e) => e.includes('duplicate')));
});

test('validateTaskAcceptance rejects invalid payment token', () => {
  const task = {
    ...BASE_TASK,
    payment: { ...BASE_TASK.payment, token: 'wrong' },
  };
  const result = validateTaskAcceptance(task, { title: '[task] echo', state: 'open' }, {
    agentParsed: AGENT,
    paymentSecrets: { tokens: new Set(['good-token']) },
    checkIssueMeta: true,
  });
  assert.equal(result.payment_ok, false);
  assert.ok(result.errors.some((e) => e.includes('invalid payment token')));
});

test('validateTaskAcceptance rejects closed issue', () => {
  const result = validateTaskAcceptance(BASE_TASK, { title: '[task] echo', state: 'closed' }, {
    agentParsed: AGENT,
    paymentSecrets: { tokens: new Set(['good-token']) },
    checkIssueMeta: true,
  });
  assert.ok(result.errors.some((e) => e.includes('not open')));
});
