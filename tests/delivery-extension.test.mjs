import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDelivery } from '../lib/extensions/delivery/prepare.mjs';
import { sendInput, fetchInput } from '../lib/extensions/delivery/input.mjs';
import { sendOutput, fetchOutput } from '../lib/extensions/delivery/output.mjs';
import { generateDeliveryKeyPair } from '../lib/extensions/delivery/hpke.mjs';
import { hashBuffer } from '../lib/hash.mjs';
import {
  setPresignedFetch,
  validatePresignedUrl,
} from '../lib/extensions/delivery/transport-presigned.mjs';
import {
  validateManifestDelivery,
  validateTaskDelivery,
} from '../lib/extensions/delivery/schema.mjs';
import { serializeTask } from '../lib/task.mjs';

test('prepare writes outbox and task extensions for presigned transport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-outbox-'));
  const result = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-delivery-1',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: dir,
  });
  assert.equal(result.extensions.delivery.transport, 'presigned-object-storage');
  const outbox = JSON.parse(await readFile(result.outbox_path, 'utf8'));
  assert.equal(outbox.artifacts.input.get_url, 'https://storage.example/input-get');
  assert.ok(outbox.ephemeral_private_key);
});

test('delivery schema requires HTTPS URLs and a node host allowlist', () => {
  const manifestDelivery = {
    scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
    receive_public_key: generateDeliveryKeyPair().public_key,
    transports: ['presigned-object-storage'],
    presigned_hosts: ['storage.example'],
  };
  assert.deepEqual(validateManifestDelivery(manifestDelivery), []);
  const delivery = {
    scheme: manifestDelivery.scheme,
    transport: 'presigned-object-storage',
    ephemeral_public_key: generateDeliveryKeyPair().public_key,
    artifacts: {
      input: { upload_url: 'https://storage.example/input' },
      output: { upload_url: 'https://storage.example/output' },
    },
  };
  assert.deepEqual(validateTaskDelivery(delivery, { manifestDelivery }), []);
  assert.ok(validateTaskDelivery({
    ...delivery,
    artifacts: {
      ...delivery.artifacts,
      output: { upload_url: 'https://other.example/output' },
    },
  }, { manifestDelivery }).some((error) => error.includes('not allowed')));
});

test('presigned transport rejects HTTP, credentials, localhost, and private addresses', () => {
  assert.equal(validatePresignedUrl('https://storage.example/object'), 'https://storage.example/object');
  for (const url of [
    'http://storage.example/object',
    'https://user:secret@storage.example/object',
    'https://localhost/object',
    'https://127.0.0.1/object',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/object',
    'https://[fc00::1]/object',
  ]) {
    assert.throws(() => validatePresignedUrl(url));
  }
});

test('prepare includes github ref in task extensions', async () => {
  const result = await prepareDelivery({
    transport: 'github-private-repo',
    requestId: 'req-gh-ref',
    github: {
      repo: 'github:alice/deliveries',
      input_path: 'inbox/{request_id}/input.enc',
      output_path: 'inbox/{request_id}/output.enc',
      ref: 'feature',
    },
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  assert.equal(result.extensions.delivery.github.ref, 'feature');
});

test('presigned send-input and fetch-input verify digest', async () => {
  const nodeKeys = generateDeliveryKeyPair();
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-delivery-2',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const input = Buffer.from('private pr patch', 'utf8');
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'code_review',
    requester: 'github:alice/caller',
    input: {
      media_type: 'application/octet-stream',
      digest: hashBuffer(input),
    },
    extensions: prepared.extensions,
  };
  const store = new Map();
  setPresignedFetch(async (url, init = {}) => {
    if (init.method === 'PUT') {
      const body = Buffer.from(init.body);
      store.set(url, body);
      if (url === 'https://storage.example/input-put') store.set('https://storage.example/input-get', body);
      if (url === 'https://storage.example/output-put') store.set('https://storage.example/output-get', body);
      return { ok: true, status: 200 };
    }
    const body = store.get(url);
    if (!body) return { ok: false, status: 404 };
    const ab = new ArrayBuffer(body.length);
    new Uint8Array(ab).set(body);
    return { ok: true, status: 200, arrayBuffer: async () => ab };
  });
  const inputFile = join(tmpdir(), 'input.bin');
  await writeFile(inputFile, input);
  await sendInput({
    task,
    manifest: { extensions: { delivery: { receive_public_key: nodeKeys.public_key } } },
    inputFile,
  });
  const outputFile = join(tmpdir(), 'fetched-input.bin');
  await fetchInput({
    task,
    outputFile,
    nodePrivateKey: nodeKeys.private_key,
    inputGetUrl: 'https://storage.example/input-get',
  });
  assert.equal((await readFile(outputFile)).toString('utf8'), input.toString('utf8'));
});

test('presigned send-output and fetch-output verify proof digest', async () => {
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-delivery-3',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const outputText = '# review\nlooks good';
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'code_review',
    requester: 'github:alice/caller',
    input: {
      media_type: 'application/octet-stream',
      digest: hashBuffer('input'),
    },
    extensions: prepared.extensions,
  };
  const store = new Map();
  setPresignedFetch(async (url, init = {}) => {
    if (init.method === 'PUT') {
      const body = Buffer.from(init.body);
      store.set(url, body);
      if (url === 'https://storage.example/input-put') store.set('https://storage.example/input-get', body);
      if (url === 'https://storage.example/output-put') store.set('https://storage.example/output-get', body);
      return { ok: true, status: 200 };
    }
    const body = store.get(url);
    if (!body) return { ok: false, status: 404 };
    const ab = new ArrayBuffer(body.length);
    new Uint8Array(ab).set(body);
    return { ok: true, status: 200, arrayBuffer: async () => ab };
  });
  const outputFile = join(tmpdir(), 'review.md');
  await writeFile(outputFile, outputText);
  await sendOutput({ task, outputFile, allowedPresignedHosts: ['storage.example'] });
  const proof = { output_digest: hashBuffer(Buffer.from(outputText, 'utf8')) };
  const fetched = join(tmpdir(), 'fetched-review.md');
  const result = await fetchOutput({
    task,
    proof,
    outboxFile: prepared.outbox_path,
    outputFile: fetched,
  });
  assert.equal(result.ok, true);
  assert.equal(await readFile(fetched, 'utf8'), outputText);
});

test('presigned output delivery preserves arbitrary binary bytes', async () => {
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-delivery-binary',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'binary',
    requester: 'github:alice/caller',
    input: {
      media_type: 'application/octet-stream',
      digest: hashBuffer('input'),
    },
    extensions: prepared.extensions,
  };
  const output = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x41]);
  let encryptedOutput = null;
  setPresignedFetch(async (url, init = {}) => {
    if (init.method === 'PUT') {
      encryptedOutput = Buffer.from(init.body);
      return { ok: true, status: 200 };
    }
    const ab = new ArrayBuffer(encryptedOutput.length);
    new Uint8Array(ab).set(encryptedOutput);
    return { ok: true, status: 200, arrayBuffer: async () => ab };
  });
  const outputFile = join(tmpdir(), 'binary-output.bin');
  const fetched = join(tmpdir(), 'fetched-binary-output.bin');
  await writeFile(outputFile, output);
  await sendOutput({ task, outputFile, allowedPresignedHosts: ['storage.example'] });
  await fetchOutput({
    task,
    proof: { output_digest: hashBuffer(output) },
    outboxFile: prepared.outbox_path,
    outputFile: fetched,
  });
  assert.deepEqual(await readFile(fetched), output);
});

test('presigned output rejects hosts outside the node allowlist', async () => {
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-delivery-ssrf',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://127.0.0.1/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const task = {
    request_id: prepared.request_id,
    extensions: prepared.extensions,
  };
  const outputFile = join(tmpdir(), 'ssrf-output.bin');
  await writeFile(outputFile, 'data');
  await assert.rejects(
    () => sendOutput({ task, outputFile, allowedPresignedHosts: ['storage.example'] }),
    /not allowed/,
  );
});

test('serializeTask preserves delivery extensions', async () => {
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-delivery-4',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-')),
  });
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input: { media_type: 'text/plain', digest: hashBuffer('x') },
    extensions: prepared.extensions,
  };
  const yaml = serializeTask(task);
  assert.match(yaml, /extensions:/);
  assert.match(yaml, /presigned-object-storage/);
});
