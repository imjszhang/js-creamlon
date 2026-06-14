import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();

test('published skills pin the current npm release and are self-contained', async () => {
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const command = `npx --yes ${packageJson.name}@${packageJson.version}`;
  const skills = [
    ['js-creamlon', ['references/protocol.md', 'references/examples.md', 'agents/openai.yaml']],
    ['creamlon-node', ['references/operations.md', 'agents/openai.yaml']],
  ];

  await assert.rejects(() => access(join(ROOT, 'SKILL.md')));
  for (const [name, files] of skills) {
    const directory = join(ROOT, 'skills', name);
    const text = await readFile(join(directory, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const file of files) await access(join(directory, file));
  }
});
