import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { acquireFileLock } from './fileLock.mjs';

export async function readDeliveryState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeDeliveryState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, path);
}

export async function acquireDeliveryLock(path) {
  return acquireFileLock(path, {
    conflictMessage: `delivery already in progress: ${path}`,
  });
}
