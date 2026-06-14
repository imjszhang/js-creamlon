import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentYaml, validateAgentYaml } from '../lib/agentYaml.mjs';

const YAML = `name: agent
description: Node
creamlon:
  version: "0.3.1"
  public_key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
  status: available
  payment_instructions: Contact the operator
  capabilities:
    - id: echo
      description: Echo
      input_types: [text/plain]
      output_types: [text/plain]
`;

test('parseAgentYaml reads the protocol schema', () => {
  const parsed = parseAgentYaml(YAML);
  assert.equal(parsed.creamlon.version, '0.3.1');
  assert.equal(parsed.creamlon.payment_instructions, 'Contact the operator');
  assert.equal(parsed.creamlon.capabilities[0].id, 'echo');
  assert.deepEqual(parsed.creamlon.capabilities[0].input_types, ['text/plain']);
});

test('validateAgentYaml accepts only the current version', () => {
  assert.deepEqual(validateAgentYaml(parseAgentYaml(YAML)), []);
  const parsed = parseAgentYaml(YAML.replace('0.3.1', '0.3.0'));
  assert.ok(validateAgentYaml(parsed).some((error) => error.includes('unsupported creamlon.version')));
});

test('validateAgentYaml requires payment instructions', () => {
  const parsed = parseAgentYaml(YAML.replace('  payment_instructions: Contact the operator\n', ''));
  assert.ok(validateAgentYaml(parsed).some((error) => error.includes('payment_instructions')));
});
