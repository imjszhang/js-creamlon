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
import { parseTask, serializeTask } from '../lib/task.mjs';
import {
  cmdExtensionDeliveryDraft,
  cmdExtensionDeliveryPrepare,
  cmdExtensionDeliverySendInput,
  cmdExtensionDeliverySendOutput,
  cmdExtensionDeliveryStatus,
  cmdExtensionDeliveryCleanup,
} from '../cli/extensionDelivery.mjs';
import { writeInboxRegistry } from '../lib/inboxRegistry.mjs';
import { setGithubFetch } from '../lib/github.mjs';

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

test('validateTaskDelivery rejects removed hpke-v1 scheme', () => {
  const manifestDelivery = {
    scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
    receive_public_key: generateDeliveryKeyPair().public_key,
    transports: ['github-private-repo'],
  };
  const delivery = {
    scheme: 'hpke-x25519-aes256gcm-v1',
    transport: 'github-private-repo',
    ephemeral_public_key: generateDeliveryKeyPair().public_key,
    github: {
      repo: 'github:alice/deliveries',
      input_path: 'inbox/req/input.enc',
      output_path: 'inbox/req/output.enc',
    },
  };
  const errors = validateTaskDelivery(delivery, { manifestDelivery });
  assert.ok(errors.some((error) => error === 'unsupported delivery.scheme: hpke-x25519-aes256gcm-v1'));
});

test('validateTaskDelivery rejects unsafe GitHub artifact paths', () => {
  const delivery = {
    scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
    transport: 'github-private-repo',
    ephemeral_public_key: generateDeliveryKeyPair().public_key,
    github: {
      repo: 'github:alice/deliveries',
      input_path: '../private/input.enc',
      output_path: 'tasks/req/output.enc',
    },
  };
  assert.ok(validateTaskDelivery(delivery)
    .some((error) => error.includes('input_path must be a safe relative path')));
  assert.ok(validateTaskDelivery({
    ...delivery,
    github: {
      ...delivery.github,
      input_path: 'tasks/other/input.enc',
      input_commit: 'a'.repeat(40),
    },
  }, { requestId: 'req-expected' })
    .some((error) => error.includes('must contain task request_id')));
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

test('delivery prepare defaults to a registered github inbox', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-registry-prepare-'));
  const registryPath = join(dir, 'inboxes.yaml');
  await writeInboxRegistry(registryPath, {
    version: '1',
    inboxes: [{
      node: 'bob/echo-node',
      operator: 'bob',
      repo: 'github:alice/creamlon-inbox-bob-echo-node',
      ref: 'main',
      trust: 'trusted',
      path_template: {
        input: 'tasks/{request_id}/input.enc',
        output: 'tasks/{request_id}/output.enc',
      },
    }],
  });
  const keys = generateDeliveryKeyPair();
  const output = [];
  await cmdExtensionDeliveryPrepare(
    ['extension', 'delivery', 'prepare', 'bob/echo-node'],
    {
      registry: registryPath,
      requestId: 'req-registry',
      outboxDir: join(dir, 'outbox'),
    },
    {
      loadManifestContext: async () => ({
        parsed: {
          extensions: {
            delivery: {
              scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
              receive_public_key: keys.public_key,
              transports: ['github-private-repo'],
            },
          },
        },
      }),
      printJson: (value) => output.push(value),
    },
  );
  assert.equal(output[0].extensions.delivery.transport, 'github-private-repo');
  assert.equal(
    output[0].extensions.delivery.github.repo,
    'github:alice/creamlon-inbox-bob-echo-node',
  );
  assert.equal(
    output[0].extensions.delivery.github.input_path,
    'tasks/req-registry/input.enc',
  );
  assert.equal(output[0].inbox_registry, registryPath);
});

test('delivery prepare rejects unsafe GitHub path overrides', async () => {
  const keys = generateDeliveryKeyPair();
  await assert.rejects(
    () => cmdExtensionDeliveryPrepare(
      ['extension', 'delivery', 'prepare', 'bob/echo-node'],
      {
        githubRepo: 'github:alice/inbox',
        githubInputPath: '../{request_id}/input.enc',
      },
      {
        loadManifestContext: async () => ({
          parsed: {
            extensions: {
              delivery: {
                scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
                receive_public_key: keys.public_key,
                transports: ['github-private-repo'],
              },
            },
          },
        }),
        printJson: () => {},
      },
    ),
    /safe relative path/,
  );
});

test('delivery prepare rejects a github inbox override pointing at the node', async () => {
  const keys = generateDeliveryKeyPair();
  await assert.rejects(
    () => cmdExtensionDeliveryPrepare(
      ['extension', 'delivery', 'prepare', 'bob/echo-node'],
      {
        githubRepo: 'github:bob/echo-node',
        requestId: 'req-node-inbox',
      },
      {
        loadManifestContext: async () => ({
          parsed: {
            extensions: {
              delivery: {
                scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
                receive_public_key: keys.public_key,
                transports: ['github-private-repo'],
              },
            },
          },
        }),
        printJson: () => {},
      },
    ),
    /inbox must be separate from node repository/,
  );
});

test('delivery prepare requires explicit consent for a trial inbox', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-trial-prepare-'));
  const registryPath = join(dir, 'inboxes.yaml');
  await writeInboxRegistry(registryPath, {
    version: '1',
    inboxes: [{
      node: 'bob/echo-node',
      operator: 'bob',
      repo: 'github:alice/trial-inbox',
      trust: 'trial',
    }],
  });
  const keys = generateDeliveryKeyPair();
  const ctx = {
    loadManifestContext: async () => ({
      parsed: {
        extensions: {
          delivery: {
            scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
            receive_public_key: keys.public_key,
            transports: ['github-private-repo'],
          },
        },
      },
    }),
    printJson: () => {},
  };
  await assert.rejects(
    () => cmdExtensionDeliveryPrepare(
      ['extension', 'delivery', 'prepare', 'bob/echo-node'],
      { registry: registryPath },
      ctx,
    ),
    /requires --allow-trial-inbox/,
  );
  await cmdExtensionDeliveryPrepare(
    ['extension', 'delivery', 'prepare', 'bob/echo-node'],
    {
      registry: registryPath,
      allowTrialInbox: true,
      outboxDir: join(dir, 'outbox'),
    },
    ctx,
  );
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

test('delivery draft writes the task used by send-input and submit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-delivery-draft-'));
  const prepared = await prepareDelivery({
    transport: 'github-private-repo',
    requestId: 'req-draft',
    github: {
      repo: 'github:alice/inbox',
      input_path: 'tasks/{request_id}/input.enc',
      output_path: 'tasks/{request_id}/output.enc',
      ref: 'main',
    },
    outboxDir: join(dir, 'outbox'),
  });
  const extensionsPath = join(dir, 'extensions.json');
  const taskPath = join(dir, 'task.yaml');
  await writeFile(extensionsPath, JSON.stringify(prepared.extensions));
  await cmdExtensionDeliveryDraft({
    taskFile: taskPath,
    extensionsFile: extensionsPath,
    requestId: prepared.request_id,
    capabilityId: 'echo',
    requester: 'github:alice/caller',
    mediaType: 'application/octet-stream',
    inputDigest: hashBuffer('input'),
  }, {
    printJson: () => {},
  });
  const task = parseTask(await readFile(taskPath, 'utf8'));
  assert.equal(task.request_id, prepared.request_id);
  assert.deepEqual(task.extensions, prepared.extensions);
});

test('github send-input writes the immutable commit to task, extensions, and outbox', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-github-send-input-'));
  const nodeKeys = generateDeliveryKeyPair();
  const prepared = await prepareDelivery({
    transport: 'github-private-repo',
    requestId: 'req-writeback',
    github: {
      repo: 'github:alice/inbox',
      input_path: 'tasks/{request_id}/input.enc',
      output_path: 'tasks/{request_id}/output.enc',
      ref: 'main',
    },
    outboxDir: join(dir, 'outbox'),
  });
  const input = Buffer.from('writeback input');
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input: { media_type: 'application/octet-stream', digest: hashBuffer(input) },
    extensions: prepared.extensions,
  };
  const taskPath = join(dir, 'task.yaml');
  const inputPath = join(dir, 'input.bin');
  const extensionsPath = join(dir, 'extensions.json');
  await writeFile(taskPath, serializeTask(task));
  await writeFile(inputPath, input);
  await writeFile(extensionsPath, `${JSON.stringify(prepared.extensions)}\n`);
  const commitSha = 'b'.repeat(40);
  setGithubFetch(async (url, init = {}) => {
    if (init.method === 'PUT') {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          content: { sha: 'content-sha' },
          commit: { sha: commitSha },
        }),
      };
    }
    return {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'not found' }),
    };
  });
  try {
    await cmdExtensionDeliverySendInput({
      taskFile: taskPath,
      inputFile: inputPath,
      extensionsFile: extensionsPath,
      outbox: prepared.outbox_path,
      receivePublicKey: nodeKeys.public_key,
      token: 'caller-token',
    }, {
      resolveToken: (opts) => opts.token,
      printJson: () => {},
    });
  } finally {
    setGithubFetch(globalThis.fetch);
  }
  assert.equal(
    parseTask(await readFile(taskPath, 'utf8')).extensions.delivery.github.input_commit,
    commitSha,
  );
  assert.equal(
    JSON.parse(await readFile(extensionsPath, 'utf8')).delivery.github.input_commit,
    commitSha,
  );
  assert.equal(
    JSON.parse(await readFile(prepared.outbox_path, 'utf8')).github.input_commit,
    commitSha,
  );
});

test('fetch-output rejects an outbox bound to a different artifact path', async () => {
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-outbox-binding',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: await mkdtemp(join(tmpdir(), 'creamlon-outbox-binding-')),
  });
  const task = {
    request_id: prepared.request_id,
    extensions: {
      delivery: {
        ...prepared.extensions.delivery,
        ephemeral_public_key: generateDeliveryKeyPair().public_key,
      },
    },
  };
  await assert.rejects(
    () => fetchOutput({
      task,
      proof: { output_digest: hashBuffer('output') },
      outboxFile: prepared.outbox_path,
      outputFile: join(tmpdir(), 'unreachable-output'),
    }),
    /outbox ephemeral_public_key does not match task delivery/,
  );
});

test('send-output records a digest-bound receipt for deliver', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-output-receipt-'));
  const prepared = await prepareDelivery({
    transport: 'presigned-object-storage',
    requestId: 'req-output-receipt',
    inputUploadUrl: 'https://storage.example/input-put',
    inputGetUrl: 'https://storage.example/input-get',
    outputUploadUrl: 'https://storage.example/output-put',
    outputGetUrl: 'https://storage.example/output-get',
    outboxDir: join(dir, 'outbox'),
  });
  const task = {
    version: '1',
    request_id: prepared.request_id,
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input: { media_type: 'application/octet-stream', digest: hashBuffer('input') },
    extensions: prepared.extensions,
  };
  const outputPath = join(dir, 'result.bin');
  await writeFile(outputPath, 'result');
  setGithubFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ body: serializeTask(task) }),
  }));
  setPresignedFetch(async (_url, init = {}) => ({
    ok: init.method === 'PUT',
    status: init.method === 'PUT' ? 200 : 404,
  }));
  try {
    await cmdExtensionDeliverySendOutput(
      ['extension', 'delivery', 'send-output', 'owner/repo', '12'],
      {
        outputFile: outputPath,
        repoPath: dir,
        token: 'node-token',
      },
      {
        loadManifestContext: async () => ({
          owner: 'owner',
          repo: 'repo',
          parsed: {
            extensions: {
              delivery: {
                scheme: prepared.extensions.delivery.scheme,
                transports: ['presigned-object-storage'],
                presigned_hosts: ['storage.example'],
              },
            },
          },
        }),
        resolveToken: (opts) => opts.token,
        printJson: () => {},
      },
    );
  } finally {
    setGithubFetch(globalThis.fetch);
    setPresignedFetch(globalThis.fetch);
  }
  const receipt = JSON.parse(await readFile(
    join(dir, '.creamlon', 'runtime', 'deliveries', '12.output.json'),
    'utf8',
  ));
  assert.equal(receipt.request_id, task.request_id);
  assert.equal(receipt.output_digest, hashBuffer('result'));
});

test('delivery status lists local state and cleanup removes closed issue state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-delivery-status-'));
  const outboxDir = join(dir, '.creamlon', 'runtime', 'outbox');
  const deliveriesDir = join(dir, '.creamlon', 'runtime', 'deliveries');
  await mkdir(outboxDir, { recursive: true });
  await mkdir(deliveriesDir, { recursive: true });
  await writeFile(join(outboxDir, 'req-cleanup.json'), `${JSON.stringify({
    request_id: 'req-cleanup',
    transport: 'github-private-repo',
  })}\n`, 'utf8');
  await writeFile(join(outboxDir, 'req-rejected.json'), `${JSON.stringify({
    request_id: 'req-rejected',
    transport: 'github-private-repo',
  })}\n`, 'utf8');
  await writeFile(join(deliveriesDir, '7.json'), `${JSON.stringify({
    version: '1',
    issue_number: 7,
    request_id: 'req-cleanup',
    status: 'closed',
    proof: { request_id: 'req-cleanup' },
  })}\n`, 'utf8');
  await writeFile(join(deliveriesDir, '8.json'), `${JSON.stringify({
    version: '1',
    issue_number: 8,
    request_id: 'req-rejected',
    status: 'closed',
  })}\n`, 'utf8');

  const output = [];
  await cmdExtensionDeliveryStatus(
    { repoPath: dir },
    { printJson: (value) => output.push(value) },
  );
  assert.equal(output.at(-1).outbox_count, 2);
  assert.equal(output.at(-1).delivery_state_count, 2);

  setGithubFetch(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/repos/owner/repo/issues/7' || path === '/repos/owner/repo/issues/8') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ number: Number(path.split('/').at(-1)), state: 'closed' }),
      };
    }
    return {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'not found' }),
    };
  });
  try {
    await cmdExtensionDeliveryCleanup(
      ['extension', 'delivery', 'cleanup', 'owner/repo'],
      { repoPath: dir, token: 'node-token' },
      {
        resolveToken: (opts) => opts.token,
        printJson: (value) => output.push(value),
      },
    );
  } finally {
    setGithubFetch(globalThis.fetch);
  }
  assert.equal(output.at(-1).removed_count, 2);
  await cmdExtensionDeliveryStatus(
    { repoPath: dir },
    { printJson: (value) => output.push(value) },
  );
  assert.equal(output.at(-1).outbox_count, 1);
  assert.equal(output.at(-1).delivery_state_count, 1);
  assert.deepEqual(output.at(-1).outboxes.map((item) => item.request_id), ['req-rejected']);
  assert.deepEqual(output.at(-1).deliveries.map((item) => item.request_id), ['req-rejected']);
});

test('delivery status falls back to legacy local state directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-delivery-legacy-status-'));
  const outboxDir = join(dir, '.creamlon', 'outbox');
  const deliveriesDir = join(dir, '.creamlon', 'deliveries');
  await mkdir(outboxDir, { recursive: true });
  await mkdir(deliveriesDir, { recursive: true });
  await writeFile(join(outboxDir, 'req-legacy.json'), `${JSON.stringify({
    request_id: 'req-legacy',
    transport: 'github-private-repo',
  })}\n`, 'utf8');
  await writeFile(join(deliveriesDir, '9.json'), `${JSON.stringify({
    version: '1',
    issue_number: 9,
    request_id: 'req-legacy',
    status: 'prepared',
  })}\n`, 'utf8');

  const output = [];
  await cmdExtensionDeliveryStatus(
    { repoPath: dir },
    { printJson: (value) => output.push(value) },
  );
  assert.equal(output.at(-1).outbox_dir, outboxDir);
  assert.equal(output.at(-1).deliveries_dir, deliveriesDir);
  assert.equal(output.at(-1).outbox_count, 1);
  assert.equal(output.at(-1).delivery_state_count, 1);
});
