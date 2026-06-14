import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const expected = `${packageJson.name}@${packageJson.version}`;
const files = [
  'README.md',
  'skills/creamlon-skill/SKILL.md',
  'skills/creamlon-skill/references/operations.md',
  'template/agent-node/README.md',
  'template/agent-node/SKILL.template.md',
];
const packageReference = /\bcreamlon@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/g;
const checkOnly = process.argv.includes('--check');
const stale = [];

for (const file of files) {
  const path = join(root, file);
  const current = await readFile(path, 'utf8');
  const references = current.match(packageReference) || [];
  if (references.length === 0) {
    throw new Error(`missing pinned Creamlon version in ${file}`);
  }

  const mismatches = references.filter((reference) => reference !== expected);
  if (mismatches.length === 0) continue;

  if (checkOnly) {
    stale.push(file);
  } else {
    await writeFile(path, current.replace(packageReference, expected), 'utf8');
  }
}

if (stale.length > 0) {
  throw new Error(`stale Creamlon version references: ${stale.join(', ')}`);
}

console.log(`${checkOnly ? 'Verified' : 'Synchronized'} ${expected}`);
