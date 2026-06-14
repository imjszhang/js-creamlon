import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireDeliveryLock } from '../lib/deliveryState.mjs';

test('delivery lock serializes credential redemption across processes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-lock-'));
  const path = join(dir, '.creamlon', 'deliver.lock');
  try {
    const release = await acquireDeliveryLock(path);
    await assert.rejects(
      () => acquireDeliveryLock(path),
      (error) => error.exitCode === 4 && error.message.includes('already in progress'),
    );
    await release();
    const releaseAgain = await acquireDeliveryLock(path);
    await releaseAgain();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('delivery lock does not steal a newly-created incomplete lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-incomplete-lock-'));
  const path = join(dir, '.creamlon', 'deliver.lock');
  try {
    await mkdir(join(dir, '.creamlon'), { recursive: true });
    await writeFile(path, '', 'utf8');
    await assert.rejects(
      () => acquireDeliveryLock(path),
      (error) => error.exitCode === 4 && error.message.includes('already in progress'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('delivery lock recovers a stale lock left by an older process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-stale-lock-'));
  const path = join(dir, '.creamlon', 'deliver.lock');
  try {
    await mkdir(join(dir, '.creamlon'), { recursive: true });
    await writeFile(path, '999999999\n', 'utf8');
    const release = await acquireDeliveryLock(path);
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
