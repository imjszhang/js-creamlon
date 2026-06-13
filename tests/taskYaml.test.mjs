import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskYaml,
  validateTaskYaml,
  isExpired,
  resolveInputHash,
  serializeTaskYaml,
  taskIssueTitle,
  isTaskIssue,
} from '../lib/taskYaml.mjs';
import { hashText } from '../lib/hash.mjs';

test('parseTaskYaml reads required and optional fields', () => {
  const yaml = `request_id: req-1
capability_id: echo
input: hello
requester: github:alice/repo
expires: 2026-12-31T00:00:00Z
payment:
  type: evm
  txid: "0xabc"
`;
  const task = parseTaskYaml(yaml);
  assert.equal(task.request_id, 'req-1');
  assert.equal(task.capability_id, 'echo');
  assert.equal(task.input, 'hello');
  assert.equal(task.expires, '2026-12-31T00:00:00Z');
  assert.deepEqual(task.payment, { type: 'evm', txid: '0xabc' });
});

test('parseTaskYaml reads input_ref', () => {
  const yaml = `request_id: req-2
capability_id: review
input_ref:
  type: url
  value: "https://example.com/doc.pdf"
requester: github:bob/repo
`;
  const task = parseTaskYaml(yaml);
  assert.deepEqual(task.input_ref, { type: 'url', value: 'https://example.com/doc.pdf' });
});

test('validateTaskYaml rejects ambiguous input', () => {
  const task = {
    request_id: 'r',
    capability_id: 'echo',
    requester: 'github:a/b',
    input: 'x',
    input_hash: hashText('x'),
    input_ref: null,
    expires: null,
    payment: null,
  };
  const errors = validateTaskYaml(task);
  assert.ok(errors.some((e) => e.includes('ambiguous input')));
});

test('validateTaskYaml requires payment when payment_required', () => {
  const task = parseTaskYaml(`request_id: r
capability_id: echo
input: hi
requester: github:a/b`);
  const errors = validateTaskYaml(task, { payment_required: true });
  assert.ok(errors.some((e) => e.includes('missing payment')));
});

test('isExpired detects past expires', () => {
  const task = { expires: '2020-01-01T00:00:00Z' };
  assert.equal(isExpired(task, new Date('2026-01-01')), true);
});

test('resolveInputHash from input, hash, and url ref', () => {
  const url = 'https://example.com/x';
  assert.equal(resolveInputHash({ input: 'hi' }), hashText('hi'));
  assert.equal(resolveInputHash({ input_hash: hashText('hi') }), hashText('hi'));
  assert.equal(
    resolveInputHash({ input_ref: { type: 'url', value: url } }),
    hashText(url),
  );
});

test('serializeTaskYaml roundtrip core fields', () => {
  const task = {
    request_id: 'req-3',
    capability_id: 'echo',
    requester: 'github:alice/repo',
    input: 'hello',
    input_hash: null,
    input_ref: null,
    expires: '2026-12-31T00:00:00Z',
    payment: { type: 'evm', txid: '0x1' },
  };
  const reparsed = parseTaskYaml(serializeTaskYaml(task));
  assert.equal(reparsed.request_id, task.request_id);
  assert.equal(reparsed.capability_id, task.capability_id);
  assert.equal(reparsed.input, task.input);
  assert.equal(reparsed.expires, task.expires);
  assert.deepEqual(reparsed.payment, task.payment);
});

test('task issue title helpers', () => {
  assert.equal(taskIssueTitle('echo'), '[task] echo');
  assert.equal(isTaskIssue('[task] echo'), true);
  assert.equal(isTaskIssue('other'), false);
});
