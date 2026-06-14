import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
