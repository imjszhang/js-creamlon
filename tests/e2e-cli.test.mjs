import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runCli } from '../cli/index.mjs';
import { parseProofJson, publicKeyFromBase64Url, verifyProof, signProof, buildProofFields, generateKeyPair } from '../lib/proof.mjs';
import { hashText, hashDigestError } from '../lib/hash.mjs';
import { parseManifest } from '../lib/manifest.mjs';
import { parseProofsLog } from '../lib/proofsLog.mjs';
import { verifyKeyContinuity } from '../lib/identity.mjs';

const BIN = join(process.cwd(), 'bin', 'creamlon.mjs');

function runCreamlon(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: process.cwd() });
}

test('cli init keygen sign verify e2e', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-e2e-'));
  try {
    await runCli(['init', dir, '--name', 'e2e-agent']);
    const manifestText = await readFile(join(dir, 'creamlon.yaml'), 'utf8');
    assert.match(manifestText, /name: e2e-agent/);

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.match(gitignore, /\.creamlon\//);

    await runCli(['keygen', '--out', join(dir, '.creamlon')]);
    const pub = (await readFile(join(dir, '.creamlon', 'public.b64url'), 'utf8')).trim();
    const digest = hashText('hello');

    const sign = runCreamlon([
      'sign',
      '--request-id', 'req-e2e',
      '--capability-id', 'echo',
      '--input-digest', digest,
      '--output-digest', digest,
      '--key', join(dir, '.creamlon', 'private.key'),
    ]);
    assert.equal(sign.status, 0, sign.stderr);

    const proof = parseProofJson(sign.stdout);
    const result = verifyProof(proof, publicKeyFromBase64Url(pub));
    assert.equal(result.ok, true);

    const proofPath = join(dir, 'proof.json');
    await writeFile(proofPath, sign.stdout, 'utf8');
    const verify = runCreamlon([
      'verify',
      '--public-key', pub,
      '--proof', proofPath,
    ]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /ok: true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli hash joins multiple words', async () => {
  const viaCli = runCreamlon(['hash', 'hello', 'world']);
  assert.equal(viaCli.status, 0, viaCli.stderr);
  assert.equal(viaCli.stdout.trim(), hashText('hello world'));
});

test('cli sign rejects invalid hash format', () => {
  const sign = runCreamlon([
    'sign',
    '--request-id', 'req-1',
    '--capability-id', 'echo',
    '--input-digest', 'sha256:aa',
    '--output-digest', hashText('out'),
    '--key', 'missing.key',
  ]);
  assert.notEqual(sign.status, 0);
  assert.match(sign.stderr, /invalid input_digest/);
});

test('cli rejects option without a value', () => {
  const result = runCreamlon(['inspect', 'owner/repo', '--token']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--token requires a value/);
});

test('cli init rejects file path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-init-'));
  const filePath = join(dir, 'not-a-dir');
  await writeFile(filePath, 'x', 'utf8');
  try {
    await assert.rejects(
      () => runCli(['init', filePath]),
      (err) => err.message.includes('path is a file'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli init rejects non-empty directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-init-'));
  await writeFile(join(dir, 'existing.txt'), 'x', 'utf8');
  try {
    await assert.rejects(
      () => runCli(['init', dir]),
      (err) => err.message.includes('directory not empty'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseManifest handles quoted name and multiple capabilities', () => {
  const yaml = `version: "1"
name: "my agent"
description: Demo
identity:
  type: ed25519
  public_key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
status: available
capabilities:
  - id: echo
    description: Echo
    input:
      media_types: [text/plain]
    output:
      media_types: [text/plain]
  - id: review
    description: Review
    input:
      media_types: [text/uri-list]
    output:
      media_types: [text/markdown]
profiles:
  github:
    transport: issues
extensions: {}
`;
  const parsed = parseManifest(yaml);
  assert.equal(parsed.name, 'my agent');
  assert.equal(parsed.capabilities.length, 2);
  assert.deepEqual(parsed.capabilities.map((c) => c.id), ['echo', 'review']);
});

test('hashDigestError validates sha256 format', () => {
  assert.equal(hashDigestError(hashText('x')), null);
  assert.match(hashDigestError('sha256:aa'), /invalid hash/);
});

test('parseProofsLog skips comments and blank lines', async () => {
  const { privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-log',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const log = `# header\n\n${JSON.stringify(proof)}\n`;
  const parsed = parseProofsLog(log);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].request_id, 'req-log');
});

test('audit verifies a valid local proof log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-audit-'));
  try {
    await runCli(['init', dir, '--name', 'audit-agent']);
    const { privateKey, publicKeyBase64Url } = await generateKeyPair(join(dir, '.creamlon'));
    const agentPath = join(dir, 'creamlon.yaml');
    const agentText = (await readFile(agentPath, 'utf8'))
      .replace('REPLACE_WITH_public.b64url', publicKeyBase64Url);
    await writeFile(agentPath, agentText, 'utf8');
    const proof = signProof(buildProofFields({
      requestId: 'req-audit',
      capabilityId: 'echo',
      inputDigest: hashText('in'),
      outputDigest: hashText('out'),
      completedAt: '2026-06-13T00:00:00.000Z',
    }), privateKey);
    await writeFile(join(dir, 'trust', 'proofs.log'), `${JSON.stringify(proof)}\n`, 'utf8');

    const logs = [];
    const originalLog = console.log;
    console.log = (message) => logs.push(message);
    try {
      await runCli(['audit', '--repo-path', dir, '--pretty']);
    } finally {
      console.log = originalLog;
    }
    const result = JSON.parse(logs.join('\n'));
    assert.equal(result.ok, true);
    assert.equal(result.proof_count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('status publishes audit health and key-rotate records continuity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-status-'));
  try {
    await runCli(['init', dir, '--name', 'status-agent']);
    const oldKeys = await generateKeyPair(join(dir, '.creamlon'));
    const newKeys = await generateKeyPair(null);
    const agentPath = join(dir, 'creamlon.yaml');
    const agentText = (await readFile(agentPath, 'utf8'))
      .replace('REPLACE_WITH_public.b64url', oldKeys.publicKeyBase64Url);
    await writeFile(agentPath, agentText, 'utf8');
    const historicalProof = signProof(buildProofFields({
      requestId: 'before-rotation',
      capabilityId: 'echo',
      inputDigest: hashText('before'),
      outputDigest: hashText('before'),
      completedAt: '2026-06-13T00:00:00.000Z',
    }), oldKeys.privateKey);
    await writeFile(join(dir, 'trust', 'proofs.log'), `${JSON.stringify(historicalProof)}\n`, 'utf8');

    await runCli(['status', '--repo-path', dir]);
    const status = JSON.parse(await readFile(join(dir, 'trust', 'status.json'), 'utf8'));
    assert.equal(status.version, '1');
    assert.equal(status.status, 'available');
    assert.equal(status.proofs_valid, true);

    await writeFile(
      agentPath,
      agentText.replace(oldKeys.publicKeyBase64Url, newKeys.publicKeyBase64Url),
      'utf8',
    );
    await runCli([
      'key-rotate',
      '--repo-path', dir,
      '--old-public-key', oldKeys.publicKeyBase64Url,
      '--new-public-key', newKeys.publicKeyBase64Url,
      '--rotated-at', '2026-06-14T00:00:00.000Z',
    ]);
    const rotations = await readFile(join(dir, 'trust', 'key-rotations.log'), 'utf8');
    assert.equal(verifyKeyContinuity(rotations, newKeys.publicKeyBase64Url).status, 'self_consistent');
    await runCli(['audit', '--repo-path', dir]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('key-rotate rejects a private key that does not match the old public key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-bad-rotation-'));
  try {
    await runCli(['init', dir, '--name', 'rotation-agent']);
    const oldKeys = await generateKeyPair(null);
    const wrongKeys = await generateKeyPair(join(dir, '.creamlon'));
    const newKeys = await generateKeyPair(null);
    const agentPath = join(dir, 'creamlon.yaml');
    const agentText = (await readFile(agentPath, 'utf8'))
      .replace('REPLACE_WITH_public.b64url', newKeys.publicKeyBase64Url);
    await writeFile(agentPath, agentText, 'utf8');
    await assert.rejects(
      () => runCli([
        'key-rotate',
        '--repo-path', dir,
        '--old-public-key', oldKeys.publicKeyBase64Url,
        '--new-public-key', newKeys.publicKeyBase64Url,
      ]),
      (error) => error.message.includes('private key does not match'),
    );
    assert.notEqual(wrongKeys.publicKeyBase64Url, oldKeys.publicKeyBase64Url);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
