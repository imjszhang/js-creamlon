import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPaymentTokens, verifyTokenPayment } from '../lib/payment/token.mjs';

test('verifyTokenPayment accepts matching token and request_id', () => {
  const task = { request_id: 'req-1' };
  const payment = { type: 'token', token: 'secret-abc', request_id: 'req-1' };
  const tokens = new Set(['secret-abc']);
  const result = verifyTokenPayment(task, payment, tokens);
  assert.equal(result.ok, true);
});

test('verifyTokenPayment rejects wrong token', () => {
  const task = { request_id: 'req-1' };
  const payment = { type: 'token', token: 'bad', request_id: 'req-1' };
  const result = verifyTokenPayment(task, payment, new Set(['secret-abc']));
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid payment token/);
});

test('verifyTokenPayment rejects request_id mismatch', () => {
  const task = { request_id: 'req-1' };
  const payment = { type: 'token', token: 'secret-abc', request_id: 'req-2' };
  const result = verifyTokenPayment(task, payment, new Set(['secret-abc']));
  assert.equal(result.ok, false);
  assert.match(result.reason, /request_id/);
});

test('verifyTokenPayment rejects missing node tokens', () => {
  const task = { request_id: 'req-1' };
  const payment = { type: 'token', token: 'x', request_id: 'req-1' };
  const result = verifyTokenPayment(task, payment, new Set());
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
});

test('loadPaymentTokens reads multiple lines from file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-pay-'));
  try {
    const filePath = join(dir, 'payment.token');
    await writeFile(filePath, 'token-a\n# comment\ntoken-b\n', 'utf8');
    const tokens = await loadPaymentTokens({ filePath });
    assert.deepEqual([...tokens].sort(), ['token-a', 'token-b']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadPaymentTokens merges explicit and env tokens', async () => {
  const prev = process.env.CREAMLON_PAYMENT_TOKEN;
  process.env.CREAMLON_PAYMENT_TOKEN = 'env-token';
  try {
    const tokens = await loadPaymentTokens({ explicit: 'cli-token' });
    assert.ok(tokens.has('cli-token'));
    assert.ok(tokens.has('env-token'));
  } finally {
    if (prev == null) delete process.env.CREAMLON_PAYMENT_TOKEN;
    else process.env.CREAMLON_PAYMENT_TOKEN = prev;
  }
});
