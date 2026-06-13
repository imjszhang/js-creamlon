import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runCli } from '../cli/index.mjs';
import { parseProofJson, publicKeyFromBase64Url, verifyProof, signProof, buildProofFields, generateKeyPair } from '../lib/proof.mjs';
import { hashText, hashDigestError } from '../lib/hash.mjs';
import { parseAgentYaml } from '../lib/agentYaml.mjs';
import { parseProofsLog } from '../lib/proofsLog.mjs';

const BIN = join(process.cwd(), 'bin', 'creamlon.mjs');

function runCreamlon(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: process.cwd() });
}

test('cli init keygen sign verify e2e', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-e2e-'));
  try {
    await runCli(['init', dir, '--name', 'e2e-agent']);
    const agentYaml = await readFile(join(dir, 'agent.yaml'), 'utf8');
    assert.match(agentYaml, /name: e2e-agent/);

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.match(gitignore, /\.creamlon\//);

    await runCli(['keygen', '--out', join(dir, '.creamlon')]);
    const pub = (await readFile(join(dir, '.creamlon', 'public.b64url'), 'utf8')).trim();
    const digest = hashText('hello');

    const sign = runCreamlon([
      'sign',
      '--request-id', 'req-e2e',
      '--capability-id', 'echo',
      '--input-hash', digest,
      '--output-hash', digest,
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
    '--input-hash', 'sha256:aa',
    '--output-hash', hashText('out'),
    '--key', 'missing.key',
  ]);
  assert.notEqual(sign.status, 0);
  assert.match(sign.stderr, /invalid input_hash/);
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

test('parseAgentYaml handles quoted name and multiple capabilities', () => {
  const yaml = `name: "my agent"
description: Demo
creamlon:
  version: "0.1"
  public_key: abc123
  capabilities:
    - id: echo
      description: Echo
    - id: review
      description: Review
`;
  const parsed = parseAgentYaml(yaml);
  assert.equal(parsed.name, 'my agent');
  assert.equal(parsed.creamlon.capabilities.length, 2);
  assert.deepEqual(parsed.creamlon.capabilities.map((c) => c.id), ['echo', 'review']);
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
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const log = `# header\n\n${JSON.stringify(proof)}\n`;
  const parsed = parseProofsLog(log);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].request_id, 'req-log');
});
