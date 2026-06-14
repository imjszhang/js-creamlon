import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTask,
  validateTask,
  isExpired,
  resolveInputDigest,
  serializeTask,
  taskIssueTitle,
  isTaskIssue,
} from '../lib/task.mjs';
import { hashText } from '../lib/hash.mjs';

const YAML = `version: "1"
request_id: req-1
capability_id: echo
requester: github:alice/repo
input:
  media_type: text/plain
  value: hello
expires: 2026-12-31T00:00:00Z
authorization:
  scheme: hmac-sha256
  key_id: customer-1
  expires: 2099-01-01T00:00:00Z
  signature: abc
`;

test('parseTask reads unified input and optional authorization', () => {
  const task = parseTask(YAML);
  assert.equal(task.version, '1');
  assert.equal(task.input.value, 'hello');
  assert.equal(task.input.media_type, 'text/plain');
  assert.equal(task.authorization.scheme, 'hmac-sha256');
});

test('validateTask accepts free tasks and requires authorization only when requested', () => {
  const free = parseTask(YAML.replace(/authorization:[\s\S]*/, ''));
  assert.deepEqual(validateTask(free), []);
  assert.ok(validateTask(free, { authorization_required: true }).includes('missing authorization'));
});

test('input requires exactly one location', () => {
  const task = parseTask(YAML.replace('  value: hello', '  value: hello\n  digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  assert.ok(validateTask(task).some((error) => error.includes('exactly one')));
});

test('resolveInputDigest hashes values and URLs or preserves digest', () => {
  const digest = hashText('hello');
  assert.equal(resolveInputDigest({ input: { value: 'hello' } }), digest);
  assert.equal(resolveInputDigest({ input: { url: 'https://example.com' } }), hashText('https://example.com'));
  assert.equal(resolveInputDigest({ input: { digest } }), digest);
});

test('serializeTask roundtrips the 1.0 task', () => {
  const task = parseTask(YAML);
  const reparsed = parseTask(serializeTask(task));
  assert.equal(reparsed.input.value, 'hello');
  assert.equal(reparsed.authorization.key_id, 'customer-1');
});

test('parseTask rejects duplicate fields', () => {
  assert.throws(
    () => parseTask('request_id: one\nrequest_id: two\n'),
    /Map keys must be unique/,
  );
});

test('old task fields are rejected', () => {
  const task = parseTask(`version: "1"
request_id: r
capability_id: echo
requester: github:a/b
input_hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
payment: {}
`);
  assert.ok(validateTask(task).some((error) => error.includes('unknown task fields')));
});

test('task issue title helpers', () => {
  assert.equal(taskIssueTitle('echo'), '[task] echo');
  assert.equal(isTaskIssue('[task] echo'), true);
  assert.equal(isTaskIssue('other'), false);
});

test('isExpired detects past expires', () => {
  assert.equal(isExpired({ expires: '2020-01-01T00:00:00Z' }, new Date('2026-01-01')), true);
});
