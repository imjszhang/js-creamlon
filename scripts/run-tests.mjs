import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

async function findTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files;
}

const files = (await findTests('tests')).sort();
if (files.length === 0) {
  console.error('No test files found');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
