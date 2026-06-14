import { test } from 'node:test';
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
  const putBranches = [];
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
      files.set(contentPath, Buffer.from(body.content, 'base64'));
      return response(true, 200, { content: { sha: 'sha-1' } });
    }
    if (path.includes('/contents/')) {
      const stored = files.get(contentPath);
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
  await sendInput({
    task,
    manifest: { extensions: { delivery: { receive_public_key: nodeKeys.public_key } } },
    inputFile,
    token: 'test-token',
  });
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
