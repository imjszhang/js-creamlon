import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, validateManifest } from '../lib/manifest.mjs';
import { generateDeliveryKeyPair } from '../lib/extensions/delivery/hpke.mjs';

const YAML = `version: "1"
name: agent
description: Node
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
profiles:
  github:
    transport: issues
extensions:
  mcp:
    server: https://example.com/mcp
`;

test('parseManifest reads the version 1 manifest', () => {
  const parsed = parseManifest(YAML);
  assert.equal(parsed.version, '1');
  assert.equal(parsed.identity.type, 'ed25519');
  assert.deepEqual(parsed.capabilities[0].input.media_types, ['text/plain']);
  assert.equal(parsed.extensions.mcp.server, 'https://example.com/mcp');
  assert.deepEqual(validateManifest(parsed, { requireGithubProfile: true }), []);
});

test('manifest rejects old wrapped schema and unknown core fields', () => {
  const old = parseManifest(`name: old
creamlon:
  version: "0.3.1"
`);
  const errors = validateManifest(old);
  assert.ok(errors.some((error) => error.includes('unsupported version')));
  assert.ok(errors.some((error) => error.includes('unknown manifest fields: creamlon')));
});

test('manifest is plain YAML and rejects Markdown front matter', () => {
  assert.equal(parseManifest(YAML).name, 'agent');
  assert.throws(() => parseManifest(`---\n${YAML}---\n# Agent\n`), /invalid creamlon.yaml/);
});

test('manifest permits namespaced extensions but rejects unsupported profiles', () => {
  assert.deepEqual(validateManifest(parseManifest(YAML)), []);
  const parsed = parseManifest(YAML.replace(
    '  github:\n    transport: issues',
    '  github:\n    transport: issues\n  unknown:\n    enabled: true',
  ));
  assert.ok(validateManifest(parsed).some((error) => error.includes('unsupported profiles')));
});

test('manifest supports credential access without changing protocol version', () => {
  const parsed = parseManifest(YAML
    .replace(
      '    output:\n      media_types: [text/plain]',
      '    output:\n      media_types: [text/plain]\n    access:\n      mode: credential\n      units: 1',
    )
    .replace(
      '  github:\n    transport: issues',
      '  github:\n    transport: issues\n  credential:\n    scheme: voucher-hmac-v1\n    instructions: Obtain a credential.',
    ));
  assert.equal(parsed.version, '1');
  assert.equal(parsed.capabilities[0].access.mode, 'credential');
  assert.deepEqual(validateManifest(parsed, { requireGithubProfile: true }), []);
});

test('credential access requires the credential profile', () => {
  const parsed = parseManifest(YAML.replace(
    '    output:\n      media_types: [text/plain]',
    '    output:\n      media_types: [text/plain]\n    access:\n      mode: credential\n      units: 1',
  ));
  assert.ok(validateManifest(parsed).some((error) => error.includes('requires profiles.credential')));
});

test('validateManifest rejects unsupported delivery extension scheme', () => {
  const keys = generateDeliveryKeyPair();
  const parsed = parseManifest(YAML.replace(
    'extensions:\n  mcp:',
    `extensions:
  delivery:
    scheme: hpke-x25519-aes256gcm-v1
    receive_public_key: ${keys.public_key}
    transports:
      - github-private-repo
  mcp:`,
  ));
  assert.ok(validateManifest(parsed, { requireGithubProfile: true })
    .some((error) => error.includes('unsupported delivery scheme: hpke-x25519-aes256gcm-v1')));
});

test('validateManifest accepts a valid delivery extension', () => {
  const keys = generateDeliveryKeyPair();
  const parsed = parseManifest(YAML.replace(
    'extensions:\n  mcp:',
    `extensions:
  delivery:
    scheme: hpke-x25519-hkdf-sha256-aes256gcm-v2
    receive_public_key: ${keys.public_key}
    transports:
      - github-private-repo
  mcp:`,
  ));
  assert.deepEqual(validateManifest(parsed, { requireGithubProfile: true }), []);
});
