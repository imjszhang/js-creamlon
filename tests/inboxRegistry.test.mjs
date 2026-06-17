import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findInbox,
  parseInboxRegistry,
  readInboxRegistry,
  updateInboxRegistry,
  upsertInbox,
  writeInboxRegistry,
} from '../lib/inboxRegistry.mjs';

function assertPrivateMode(mode) {
  if (process.platform !== 'win32') assert.equal(mode & 0o077, 0);
}

test('caller inbox registry roundtrips per-node entries privately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-inboxes-'));
  const path = join(dir, 'inboxes.yaml');
  const entry = {
    node: 'bob/echo-node',
    operator: 'bob',
    repo: 'github:alice/creamlon-inbox-bob-echo-node',
    ref: 'main',
    trust: 'trusted',
    path_template: {
      input: 'tasks/{request_id}/input.enc',
      output: 'tasks/{request_id}/output.enc',
    },
  };
  const written = await writeInboxRegistry(path, upsertInbox({ inboxes: [] }, entry));
  const registry = await readInboxRegistry(written);
  assert.deepEqual(findInbox(registry, entry.node), {
    ...entry,
    grant: null,
    granted_at: null,
  });
  assertPrivateMode((await stat(written)).mode);
  assert.match(await readFile(written, 'utf8'), /version: "1"/);
});

test('caller inbox registry serializes concurrent updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-inboxes-concurrent-'));
  const path = join(dir, 'inboxes.yaml');
  const entry = (node) => ({
    node,
    operator: node.split('/')[0],
    repo: `github:alice/inbox-${node.replace('/', '-')}`,
  });
  await Promise.all([
    updateInboxRegistry(path, async (registry) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return upsertInbox(registry, entry('bob/echo'));
    }),
    updateInboxRegistry(path, (registry) => upsertInbox(registry, entry('carol/translate'))),
  ]);
  const registry = await readInboxRegistry(path);
  assert.deepEqual(
    registry.inboxes.map((item) => item.node),
    ['bob/echo', 'carol/translate'],
  );
});

test('caller inbox registry rejects duplicate nodes and unsafe paths', () => {
  assert.throws(
    () => parseInboxRegistry(`version: "1"
inboxes:
  - node: bob/echo
    operator: bob
    repo: github:alice/inbox-a
  - node: bob/echo
    operator: bob
    repo: github:alice/inbox-b
`),
    /duplicate node/,
  );
  assert.throws(
    () => upsertInbox({ inboxes: [] }, {
      node: 'bob/echo',
      operator: 'bob',
      repo: 'github:alice/inbox',
      path_template: {
        input: '../{request_id}/input.enc',
        output: 'tasks/{request_id}/output.enc',
      },
    }),
    /relative repository path/,
  );
  assert.throws(
    () => upsertInbox({ inboxes: [] }, {
      node: 'bob/echo',
      operator: 'bob',
      repo: 'github:alice/inbox',
      path_template: {
        input: 'tasks/{request_id}/input.enc\nextra',
        output: 'tasks/{request_id}/output.enc',
      },
    }),
    /relative repository path/,
  );
  assert.throws(
    () => parseInboxRegistry(`version: "1"
inboxes:
  - node: bob/echo
    operator: bob
    repo: github:alice/inbox
    trsut: blocked
`),
    /unknown inbox fields: trsut/,
  );
  assert.throws(
    () => parseInboxRegistry(`version: "1"
inboxes:
  - node: bob/echo
    operator: bob
    repo: github:alice/inbox
  - node: BOB/ECHO
    operator: bob
    repo: github:alice/other
`),
    /duplicate node/,
  );
});
