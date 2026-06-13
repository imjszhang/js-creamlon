import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentYaml, validateAgentYaml } from '../lib/agentYaml.mjs';

test('parseAgentYaml reads payment fields', () => {
  const yaml = `name: paid-agent
description: Paid node
creamlon:
  version: "0.2"
  public_key: abc
  payment_required: true
  payment_instructions: Send ETH with request_id in metadata
  capabilities:
    - id: echo
      description: Echo
`;
  const parsed = parseAgentYaml(yaml);
  assert.equal(parsed.creamlon.payment_required, true);
  assert.match(parsed.creamlon.payment_instructions, /request_id/);
});

test('validateAgentYaml warns when payment_required without instructions', () => {
  const parsed = {
    name: 'x',
    creamlon: {
      version: '0.2',
      public_key: 'k',
      capabilities: [{ id: 'echo', description: 'e' }],
      payment_required: true,
      payment_instructions: null,
    },
  };
  const errors = validateAgentYaml(parsed);
  assert.ok(errors.some((e) => e.includes('payment_instructions')));
});
