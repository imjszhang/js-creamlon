import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readOutbox(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed?.request_id) throw new Error('invalid outbox: missing request_id');
  return parsed;
}

export async function writeOutbox(path, record) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, path);
}

export function outboxPath(outboxDir, requestId) {
  return `${outboxDir.replace(/\/$/, '')}/${requestId}.json`;
}
