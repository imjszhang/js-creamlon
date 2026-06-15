import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readOutbox(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed?.request_id) throw new Error('invalid outbox: missing request_id');
  return parsed;
}

function mismatch(field) {
  throw new Error(`outbox ${field} does not match task delivery`);
}

export function assertOutboxMatchesTask(outbox, task, { requireInputCommit = true } = {}) {
  const delivery = task?.extensions?.delivery;
  if (!delivery) throw new Error('task has no delivery extension');
  if (outbox?.request_id !== task.request_id) mismatch('request_id');
  if (outbox?.scheme !== delivery.scheme) mismatch('scheme');
  if (outbox?.transport !== delivery.transport) mismatch('transport');
  if (outbox?.ephemeral_public_key !== delivery.ephemeral_public_key) {
    mismatch('ephemeral_public_key');
  }
  if (delivery.transport === 'github-private-repo') {
    for (const field of ['repo', 'ref', 'input_path', 'output_path']) {
      const taskValue = field === 'ref'
        ? delivery.github?.ref || 'main'
        : delivery.github?.[field];
      const outboxValue = field === 'ref'
        ? outbox.github?.ref || 'main'
        : outbox.github?.[field];
      if (outboxValue !== taskValue) mismatch(`github.${field}`);
    }
    if (requireInputCommit
      && outbox.github?.input_commit !== delivery.github?.input_commit) {
      mismatch('github.input_commit');
    }
  }
  return true;
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
