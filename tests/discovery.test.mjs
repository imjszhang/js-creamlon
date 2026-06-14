import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverRepositories, sortDiscoveryResults } from '../lib/discovery.mjs';
import { readDiscoveryCache, writeDiscoveryCache } from '../lib/discoveryCache.mjs';
import {
  inspectKeyContinuity,
  signKeyRotation,
  verifyKeyContinuity,
} from '../lib/identity.mjs';
import {
  buildProofFields,
  generateKeyPair,
  signProof,
} from '../lib/proof.mjs';
import { hashText } from '../lib/hash.mjs';

function agentYaml(publicKey, status = 'available') {
  return `name: echo-node
description: Public echo service
creamlon:
  version: "0.3.1"
  public_key: ${publicKey}
  status: ${status}
  payment_instructions: Contact operator
  capabilities:
    - id: echo
      description: Echo text
      input_types: [text/plain]
      output_types: [text/plain]
`;
}

function repository(name, overrides = {}) {
  return {
    full_name: `owner/${name}`,
    html_url: `https://github.com/owner/${name}`,
    default_branch: 'main',
    archived: false,
    fork: false,
    disabled: false,
    has_issues: true,
    updated_at: '2026-06-13T00:00:00Z',
    stargazers_count: 2,
    ...overrides,
  };
}

test('discoverRepositories validates, filters, and summarizes public trust files', async () => {
  const oldKeys = await generateKeyPair(null);
  const currentKeys = await generateKeyPair(null);
  const proof = signProof(buildProofFields({
    requestId: 'request-1',
    capabilityId: 'echo',
    inputHash: hashText('hello'),
    outputHash: hashText('hello'),
    completedAt: '2026-06-13T12:00:00.000Z',
  }), currentKeys.privateKey);
  const rotation = signKeyRotation({
    oldPublicKey: oldKeys.publicKeyBase64Url,
    newPublicKey: currentKeys.publicKeyBase64Url,
    rotatedAt: '2026-06-12T00:00:00.000Z',
  }, oldKeys.privateKey);
  const files = new Map([
    ['owner/good:agent.yaml', agentYaml(currentKeys.publicKeyBase64Url)],
    ['owner/good:trust/proofs.log', `${JSON.stringify(proof)}\n`],
    ['owner/good:trust/key-rotations.log', `${JSON.stringify(rotation)}\n`],
    ['owner/good:trust/status.json', JSON.stringify({
      v: '0.3.1',
      status: 'available',
      checked_at: '2026-06-14T00:00:00.000Z',
      proofs_valid: true,
    })],
    ['owner/offline:agent.yaml', agentYaml(currentKeys.publicKeyBase64Url, 'offline')],
  ]);

  const result = await discoverRepositories([
    repository('good'),
    repository('offline'),
    repository('archived', { archived: true }),
  ], {
    capabilityId: 'echo',
    inputType: 'text/plain',
    outputType: 'text/plain',
    now: new Date('2026-06-14T01:00:00.000Z'),
    fetchFile: async (repo, path, _ref, optional) => {
      const value = files.get(`${repo.full_name}:${path}`);
      if (value == null && optional) return null;
      if (value == null) throw new Error('missing file');
      return value;
    },
  });

  assert.equal(result.result_count, 1);
  assert.equal(result.results[0].repo, 'owner/good');
  assert.equal(result.results[0].signature_log_status, 'valid');
  assert.equal(result.results[0].signed_proof_count, 1);
  assert.equal(result.results[0].key_continuity, 'self_consistent');
  assert.equal(result.results[0].health.status, 'fresh');
  assert.equal(result.skipped_count, 1);
});

test('discovery verifies historical proofs with the key active at completion time', async () => {
  const oldKeys = await generateKeyPair(null);
  const currentKeys = await generateKeyPair(null);
  const proof = signProof(buildProofFields({
    requestId: 'old-request',
    capabilityId: 'echo',
    inputHash: hashText('old'),
    outputHash: hashText('old'),
    completedAt: '2026-06-01T00:00:00.000Z',
  }), oldKeys.privateKey);
  const rotation = signKeyRotation({
    oldPublicKey: oldKeys.publicKeyBase64Url,
    newPublicKey: currentKeys.publicKeyBase64Url,
    rotatedAt: '2026-06-10T00:00:00.000Z',
  }, oldKeys.privateKey);
  const files = {
    'agent.yaml': agentYaml(currentKeys.publicKeyBase64Url),
    'trust/proofs.log': `${JSON.stringify(proof)}\n`,
    'trust/key-rotations.log': `${JSON.stringify(rotation)}\n`,
  };
  const result = await discoverRepositories([repository('rotated')], {
    capabilityId: 'echo',
    fetchFile: async (_repo, path, _ref, optional) => files[path] ?? (optional ? null : Promise.reject(new Error('missing'))),
  });
  assert.equal(result.results[0].signature_log_status, 'valid');
  assert.equal(result.results[0].signed_proof_count, 1);
});

test('default discovery sorting ignores self-published proof counts', () => {
  const base = {
    status: 'available',
    updated_at: '2026-06-01T00:00:00Z',
  };
  const sorted = sortDiscoveryResults([
    { ...base, repo: 'owner/b', signed_proof_count: 1000 },
    { ...base, repo: 'owner/a', signed_proof_count: 0 },
  ]);
  assert.deepEqual(sorted.map((item) => item.repo), ['owner/a', 'owner/b']);
});

test('verifyKeyContinuity rejects a rotation signed by the wrong key', async () => {
  const oldKeys = await generateKeyPair(null);
  const wrongKeys = await generateKeyPair(null);
  const currentKeys = await generateKeyPair(null);
  const rotation = signKeyRotation({
    oldPublicKey: oldKeys.publicKeyBase64Url,
    newPublicKey: currentKeys.publicKeyBase64Url,
  }, wrongKeys.privateKey);
  const result = verifyKeyContinuity(`${JSON.stringify(rotation)}\n`, currentKeys.publicKeyBase64Url);
  assert.equal(result.status, 'broken');
  assert.ok(result.errors.some((error) => error.includes('invalid signature')));
});

test('a self-created rotation chain is not reported as externally verified', async () => {
  const inventedOld = await generateKeyPair(null);
  const currentKeys = await generateKeyPair(null);
  const rotation = signKeyRotation({
    oldPublicKey: inventedOld.publicKeyBase64Url,
    newPublicKey: currentKeys.publicKeyBase64Url,
  }, inventedOld.privateKey);
  const text = `${JSON.stringify(rotation)}\n`;
  assert.equal(verifyKeyContinuity(text, currentKeys.publicKeyBase64Url).status, 'self_consistent');
  const anchored = inspectKeyContinuity(
    text,
    currentKeys.publicKeyBase64Url,
    { trustedPublicKey: inventedOld.publicKeyBase64Url },
  );
  assert.equal(anchored.status, 'verified');
});

test('discovery excludes private repositories', async () => {
  let fetched = false;
  const result = await discoverRepositories([
    repository('private', { private: true, visibility: 'private' }),
  ], {
    capabilityId: 'echo',
    fetchFile: async () => {
      fetched = true;
      return '';
    },
  });
  assert.equal(fetched, false);
  assert.equal(result.result_count, 0);
  assert.equal(result.skipped_count, 1);
});

test('discovery cache stores values and expires them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-discovery-'));
  const path = join(dir, 'cache.json');
  try {
    await writeDiscoveryCache(path, 'echo', { results: [1] });
    assert.deepEqual(await readDiscoveryCache(path, 'echo', 60_000), { results: [1] });
    const cache = JSON.parse(await readFile(path, 'utf8'));
    cache.echo.created_at = '2000-01-01T00:00:00.000Z';
    await writeFile(path, JSON.stringify(cache), 'utf8');
    assert.equal(await readDiscoveryCache(path, 'echo', 60_000), null);
    cache.echo.created_at = 'not-a-date';
    await writeFile(path, JSON.stringify(cache), 'utf8');
    assert.equal(await readDiscoveryCache(path, 'echo', 60_000), null);
    cache.echo.created_at = '2999-01-01T00:00:00.000Z';
    await writeFile(path, JSON.stringify(cache), 'utf8');
    assert.equal(await readDiscoveryCache(path, 'echo', 60_000), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
