import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findInbox,
  parseInboxRegistry,
  readInboxRegistry,
  upsertInbox,
  writeInboxRegistry,
} from '../lib/inboxRegistry.mjs';

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
  assert.equal((await stat(written)).mode & 0o077, 0);
  assert.match(await readFile(written, 'utf8'), /version: "1"/);
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
});
