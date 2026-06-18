import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runCli } from '../cli/index.mjs';
import { parseManifest, setManifestFetch, validateManifest } from '../lib/manifest.mjs';
import { parseManifestPayment } from '../lib/extensions/payment/schema.mjs';
import { parseManifestDelivery } from '../lib/extensions/delivery/schema.mjs';
import { generateKeyPair } from '../lib/proof.mjs';
import { generateDeliveryKeyPair } from '../lib/extensions/delivery/hpke.mjs';

const BIN = join(process.cwd(), 'bin', 'creamlon.mjs');

function manifestYaml(publicKey) {
  return `version: "1"
name: manifest-edit-node
description: Editable node
identity:
  type: ed25519
  public_key: ${publicKey}
status: available
capabilities:
  - id: echo
    description: Echo
    input:
      media_types: [text/plain]
    output:
      media_types: [text/plain]
profiles:
  github:
    transport: issues
extensions: {}
`;
}

function runCreamlon(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: process.cwd() });
}

async function createNode() {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-manifest-edit-'));
  const { publicKeyBase64Url } = await generateKeyPair(null);
  await writeFile(join(dir, 'creamlon.yaml'), manifestYaml(publicKeyBase64Url), 'utf8');
  return dir;
}

async function readManifest(dir) {
  return parseManifest(await readFile(join(dir, 'creamlon.yaml'), 'utf8'));
}

function assertManifestValid(manifest) {
  assert.deepEqual(validateManifest(manifest, { requireGithubProfile: true }), []);
}

test('capability add appends a credential capability and credential profile', async () => {
  const dir = await createNode();
  try {
    const result = runCreamlon([
      'capability', 'add',
      '--repo-path', dir,
      '--id', 'code_review',
      '--description', 'Review code',
      '--input-type', 'text/plain,application/json',
      '--output-type', 'text/markdown',
      '--access', 'credential',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);

    const manifest = await readManifest(dir);
    assertManifestValid(manifest);
    assert.equal(manifest.capabilities.length, 2);
    assert.equal(manifest.capabilities[1].id, 'code_review');
    assert.deepEqual(manifest.capabilities[1].input.media_types, ['text/plain', 'application/json']);
    assert.equal(manifest.capabilities[1].access.mode, 'credential');
    assert.equal(manifest.profiles.credential.scheme, 'voucher-hmac-v1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('capability add rejects duplicate ids', async () => {
  const dir = await createNode();
  try {
    const result = runCreamlon([
      'capability', 'add',
      '--repo-path', dir,
      '--id', 'echo',
      '--description', 'Duplicate',
      '--input-type', 'text/plain',
      '--output-type', 'text/plain',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /capability already exists/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('capability update modifies only requested fields', async () => {
  const dir = await createNode();
  try {
    const result = runCreamlon([
      'capability', 'update',
      '--repo-path', dir,
      '--id', 'echo',
      '--description', 'Updated echo',
      '--input-type', 'text/plain,application/json',
      '--access', 'credential',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = await readManifest(dir);
    assertManifestValid(manifest);
    assert.equal(manifest.capabilities[0].description, 'Updated echo');
    assert.deepEqual(manifest.capabilities[0].input.media_types, ['text/plain', 'application/json']);
    assert.deepEqual(manifest.capabilities[0].output.media_types, ['text/plain']);
    assert.equal(manifest.capabilities[0].access.mode, 'credential');
    assert.equal(manifest.profiles.credential.scheme, 'voucher-hmac-v1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('capability remove rejects removing the last capability', async () => {
  const dir = await createNode();
  try {
    const result = runCreamlon([
      'capability', 'remove',
      '--repo-path', dir,
      '--id', 'echo',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot remove the last capability/);
    assert.deepEqual((await readManifest(dir)).capabilities.map((item) => item.id), ['echo']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('payment set-provider creates and updates a provider hint', async () => {
  const dir = await createNode();
  try {
    let result = runCreamlon([
      'payment', 'set-provider',
      '--repo-path', dir,
      '--capability-id', 'echo',
      '--provider-id', 'x402',
      '--resource-url', 'https://pay.example/buy/echo',
      '--network', 'base',
      '--asset', 'USDC',
      '--price', '0.50',
      '--pay-to', '0x1111111111111111111111111111111111111111',
      '--facilitator', 'https://x402.facilitator.example',
      '--instructions', 'Pay to receive a credential.',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).updated, false);

    result = runCreamlon([
      'payment', 'set-provider',
      '--repo-path', dir,
      '--capability-id', 'echo',
      '--provider-id', 'x402',
      '--resource-url', 'https://pay.example/buy/echo-v2',
      '--price', '0.75',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).updated, true);

    const payment = parseManifestPayment(await readManifest(dir));
    assert.equal(payment.pattern, 'payment-bridge-v1');
    assert.equal(payment.instructions, 'Pay to receive a credential.');
    assert.equal(payment.providers.length, 1);
    assert.equal(payment.providers[0].resource_url, 'https://pay.example/buy/echo-v2');
    assert.equal(payment.providers[0].price, '0.75');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('capability remove also removes matching payment providers', async () => {
  const dir = await createNode();
  try {
    let result = runCreamlon([
      'capability', 'add',
      '--repo-path', dir,
      '--id', 'code_review',
      '--description', 'Review code',
      '--input-type', 'text/plain',
      '--output-type', 'text/markdown',
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = runCreamlon([
      'payment', 'set-provider',
      '--repo-path', dir,
      '--capability-id', 'echo',
      '--provider-id', 'x402',
      '--resource-url', 'https://pay.example/buy/echo',
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = runCreamlon([
      'capability', 'remove',
      '--repo-path', dir,
      '--id', 'echo',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.removed_payment_providers, 1);

    const manifest = await readManifest(dir);
    assert.deepEqual(manifest.capabilities.map((item) => item.id), ['code_review']);
    assert.equal(parseManifestPayment(manifest), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('payment remove-provider removes the payment extension when empty', async () => {
  const dir = await createNode();
  try {
    let result = runCreamlon([
      'payment', 'set-provider',
      '--repo-path', dir,
      '--capability-id', 'echo',
      '--provider-id', 'stripe',
      '--checkout-url', 'https://shop.example/checkout',
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = runCreamlon([
      'payment', 'remove-provider',
      '--repo-path', dir,
      '--capability-id', 'echo',
      '--provider-id', 'stripe',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).removed, 1);
    assert.equal(parseManifestPayment(await readManifest(dir)), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('node set-status updates availability and rejects invalid status', async () => {
  const dir = await createNode();
  try {
    let result = runCreamlon([
      'node', 'set-status', 'busy',
      '--repo-path', dir,
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await readManifest(dir)).status, 'busy');

    result = runCreamlon([
      'node', 'set-status', 'maintenance',
      '--repo-path', dir,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /available, busy, or offline/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('node set-name and set-description update node metadata', async () => {
  const dir = await createNode();
  try {
    let result = runCreamlon(['node', 'set-name', 'new-name', '--repo-path', dir, '--pretty']);
    assert.equal(result.status, 0, result.stderr);
    result = runCreamlon(['node', 'set-description', 'New description', '--repo-path', dir, '--pretty']);
    assert.equal(result.status, 0, result.stderr);
    const manifest = await readManifest(dir);
    assert.equal(manifest.name, 'new-name');
    assert.equal(manifest.description, 'New description');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('delivery set-config and show-config manage manifest delivery extension', async () => {
  const dir = await createNode();
  try {
    const deliveryKeys = generateDeliveryKeyPair();
    let result = runCreamlon([
      'delivery', 'set-config',
      '--repo-path', dir,
      '--scheme', 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
      '--receive-public-key', deliveryKeys.public_key,
      '--transports', 'github-private-repo,presigned-object-storage',
      '--presigned-hosts', 'storage.example,cdn.example',
      '--github-input-path', 'tasks/{request_id}/input.enc',
      '--github-output-path', 'tasks/{request_id}/output.enc',
      '--pretty',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = await readManifest(dir);
    const delivery = parseManifestDelivery(manifest);
    assert.equal(delivery.receive_public_key, deliveryKeys.public_key);
    assert.deepEqual(delivery.transports, ['github-private-repo', 'presigned-object-storage']);
    assert.deepEqual(delivery.presigned_hosts, ['storage.example', 'cdn.example']);
    assert.equal(delivery.github.inbox_path_template.input, 'tasks/{request_id}/input.enc');

    result = runCreamlon(['delivery', 'show-config', '--repo-path', dir, '--pretty']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).delivery.receive_public_key, deliveryKeys.public_key);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('capability list and payment list print local manifest configuration', async () => {
  const dir = await createNode();
  try {
    let result = runCreamlon(['capability', 'list', '--repo-path', dir, '--pretty']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).capabilities.map((item) => item.id), ['echo']);

    result = runCreamlon(['payment', 'list', '--repo-path', dir, '--pretty']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).providers, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inspect exposes payment_extension from remote manifests', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);
  const remoteManifest = manifestYaml(publicKeyBase64Url).replace(
    'extensions: {}',
    `extensions:
  payment:
    pattern: payment-bridge-v1
    providers:
      - id: x402
        capability_id: echo
        resource_url: https://pay.example/buy/echo`,
  );
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  setManifestFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => remoteManifest,
  }));
  try {
    await runCli(['inspect', 'owner/repo', '--pretty']);
  } finally {
    console.log = originalLog;
    setManifestFetch(globalThis.fetch);
  }
  const output = JSON.parse(lines.join('\n'));
  assert.equal(output.payment_extension.pattern, 'payment-bridge-v1');
  assert.equal(output.payment_extension.providers[0].id, 'x402');
});
