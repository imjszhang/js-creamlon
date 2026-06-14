import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, validateManifest } from '../lib/manifest.mjs';

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
