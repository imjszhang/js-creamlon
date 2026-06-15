import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setGithubFetch } from '../lib/github.mjs';
import { prepareDelivery } from '../lib/extensions/delivery/prepare.mjs';
import { sendInput, fetchInput } from '../lib/extensions/delivery/input.mjs';
import { sendOutput, fetchOutput } from '../lib/extensions/delivery/output.mjs';
import { generateDeliveryKeyPair } from '../lib/extensions/delivery/hpke.mjs';
import { hashBuffer } from '../lib/hash.mjs';

after(() => setGithubFetch(globalThis.fetch));

test('github transport uploads and fetches encrypted artifacts', async () => {
  const nodeKeys = generateDeliveryKeyPair();
  const prepared = await prepareDelivery({
    transport: 'github-private-repo',
    requestId: 'req-gh-1',
    github: {
      repo: 'github:alice/deliveries',
      input_path: 'inbox/{request_id}/input.enc',
      output_path: 'inbox/{request_id}/output.enc',
      ref: 'delivery-branch',
    },
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const files = new Map();
  const snapshots = new Map();
  const putBranches = [];
  let commitCounter = 0;
  const response = (ok, status, data) => ({
    ok,
    status,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  });
  setGithubFetch(async (path, init = {}) => {
    const contentPath = decodeURIComponent(path.split('/contents/')[1]?.split('?')[0] || '');
    if (path.includes('/contents/') && init.method === 'PUT') {
      const body = JSON.parse(init.body);
      putBranches.push(body.branch);
      const bytes = Buffer.from(body.content, 'base64');
      files.set(contentPath, bytes);
      commitCounter += 1;
      const commitSha = String(commitCounter).padStart(40, 'a');
      snapshots.set(`${commitSha}:${contentPath}`, bytes);
      return response(true, 200, {
        content: { sha: `content-${commitCounter}` },
        commit: { sha: commitSha },
      });
    }
    if (path.includes('/contents/')) {
      const ref = new URL(path, 'https://api.github.test').searchParams.get('ref');
      const stored = snapshots.get(`${ref}:${contentPath}`) || files.get(contentPath);
      if (!stored) {
        return response(false, 404, { message: 'not found' });
      }
      return response(true, 200, {
        type: 'file',
        content: stored.toString('base64'),
        encoding: 'base64',
      });
    }
    return response(true, 200, {});
  });

  const input = Buffer.from('secret input', 'utf8');
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'code_review',
    requester: 'github:alice/caller',
    input: { media_type: 'application/octet-stream', digest: hashBuffer(input) },
    extensions: prepared.extensions,
  };
  const inputFile = join(tmpdir(), 'gh-input.bin');
  await writeFile(inputFile, input);
  const sentInput = await sendInput({
    task,
    manifest: { extensions: { delivery: { receive_public_key: nodeKeys.public_key } } },
    inputFile,
    token: 'test-token',
  });
  task.extensions.delivery.github.input_commit = sentInput.input_commit;
  const outbox = JSON.parse(await readFile(prepared.outbox_path, 'utf8'));
  outbox.github.input_commit = sentInput.input_commit;
  await writeFile(prepared.outbox_path, `${JSON.stringify(outbox)}\n`);
  assert.match(sentInput.input_commit, /^[a-f0-9]{40}$/);
  const fetchedInput = join(tmpdir(), 'gh-fetched-input.bin');
  await fetchInput({
    task,
    outputFile: fetchedInput,
    nodePrivateKey: nodeKeys.private_key,
    token: 'test-token',
  });
  assert.equal((await readFile(fetchedInput)).toString('utf8'), input.toString('utf8'));

  const outputText = 'done';
  const outputFile = join(tmpdir(), 'gh-output.md');
  await writeFile(outputFile, outputText);
  await sendOutput({ task, outputFile, token: 'test-token' });
  const fetchedOutput = join(tmpdir(), 'gh-fetched-output.md');
  await fetchOutput({
    task,
    proof: { output_digest: hashBuffer(Buffer.from(outputText, 'utf8')) },
    outboxFile: prepared.outbox_path,
    outputFile: fetchedOutput,
    token: 'test-token',
  });
  assert.equal(await readFile(fetchedOutput, 'utf8'), outputText);
  assert.deepEqual(putBranches, ['delivery-branch', 'delivery-branch']);
  assert.equal(prepared.extensions.delivery.github.ref, 'delivery-branch');
});

test('github input fetch is pinned to the upload commit', async () => {
  const nodeKeys = generateDeliveryKeyPair();
  const prepared = await prepareDelivery({
    transport: 'github-private-repo',
    requestId: 'req-pinned-input',
    github: {
      repo: 'github:alice/deliveries',
      input_path: 'tasks/{request_id}/input.enc',
      output_path: 'tasks/{request_id}/output.enc',
      ref: 'main',
    },
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const files = new Map();
  const snapshots = new Map();
  const originalCommit = 'a'.repeat(40);
  setGithubFetch(async (url, init = {}) => {
    const parsed = new URL(url);
    const contentPath = decodeURIComponent(parsed.pathname.split('/contents/')[1] || '');
    if (init.method === 'PUT') {
      const bytes = Buffer.from(JSON.parse(init.body).content, 'base64');
      files.set(contentPath, bytes);
      snapshots.set(`${originalCommit}:${contentPath}`, bytes);
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          content: { sha: 'content-sha' },
          commit: { sha: originalCommit },
        }),
      };
    }
    const bytes = snapshots.get(`${parsed.searchParams.get('ref')}:${contentPath}`)
      || files.get(contentPath);
    return {
      ok: Boolean(bytes),
      status: bytes ? 200 : 404,
      text: async () => JSON.stringify(bytes
        ? { type: 'file', content: bytes.toString('base64'), encoding: 'base64' }
        : { message: 'not found' }),
    };
  });
  const input = Buffer.from('immutable input');
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input: { media_type: 'application/octet-stream', digest: hashBuffer(input) },
    extensions: prepared.extensions,
  };
  const inputFile = join(tmpdir(), 'pinned-input.bin');
  await writeFile(inputFile, input);
  const sent = await sendInput({
    task,
    manifest: { extensions: { delivery: { receive_public_key: nodeKeys.public_key } } },
    inputFile,
    token: 'caller-token',
  });
  task.extensions.delivery.github.input_commit = sent.input_commit;
  files.set(task.extensions.delivery.github.input_path, Buffer.from('tampered branch head'));
  const fetched = join(tmpdir(), 'pinned-input-fetched.bin');
  await fetchInput({
    task,
    outputFile: fetched,
    nodePrivateKey: nodeKeys.private_key,
    token: 'node-token',
  });
  assert.deepEqual(await readFile(fetched), input);
});

test('github transport explains cross-account private repository access failures', async () => {
  const nodeKeys = generateDeliveryKeyPair();
  const task = {
    version: '1',
    request_id: 'req-cross-account',
    capability_id: 'code_review',
    requester: 'github:alice/caller',
    input: { media_type: 'application/octet-stream', digest: hashBuffer(Buffer.from('input')) },
    extensions: {
      delivery: {
        scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
        transport: 'github-private-repo',
        ephemeral_public_key: nodeKeys.public_key,
        github: {
          repo: 'github:alice/delivery-inbox',
          ref: 'main',
          input_path: 'inbox/req-cross-account/input.enc',
          output_path: 'inbox/req-cross-account/output.enc',
        },
      },
    },
  };
  setGithubFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ message: 'Not Found' }),
  }));

  await assert.rejects(
    () => fetchInput({
      task,
      outputFile: join(tmpdir(), 'cross-account-input.bin'),
      nodePrivateKey: nodeKeys.private_key,
      token: 'node-token',
    }),
    (error) => {
      assert.equal(error.status, 404);
      assert.match(error.message, /cannot read delivery artifact/);
      assert.match(error.message, /github:alice\/delivery-inbox/);
      assert.match(error.message, /token has read access/);
      return true;
    },
  );

  const outputFile = join(tmpdir(), 'cross-account-output.bin');
  await writeFile(outputFile, 'output');
  setGithubFetch(async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ message: 'Forbidden' }),
  }));
  await assert.rejects(
    () => sendOutput({ task, outputFile, token: 'node-token' }),
    (error) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /cannot write delivery artifact/);
      assert.match(error.message, /github:alice\/delivery-inbox/);
      assert.match(error.message, /token has write access/);
      return true;
    },
  );
});
