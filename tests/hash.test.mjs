import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { hashText, hashBuffer, hashFileBytes } from '../lib/hash.mjs';

const BIN = join(process.cwd(), 'bin', 'creamlon.mjs');

function runCreamlon(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: process.cwd() });
}

test('hashFileBytes hashes raw file bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-hash-'));
  try {
    const path = join(dir, 'binary.bin');
    const bytes = Buffer.from([0x00, 0xff, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    await writeFile(path, bytes);
    assert.equal(await hashFileBytes(path), hashBuffer(bytes));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli hash --file uses raw bytes not utf8 text decoding', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-hash-cli-'));
  try {
    const path = join(dir, 'binary.bin');
    const bytes = Buffer.from([0x00, 0xff, 0x01]);
    await writeFile(path, bytes);
    const result = runCreamlon(['hash', '--file', path]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), hashBuffer(bytes));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
