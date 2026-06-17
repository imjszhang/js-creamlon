import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function isLockConflict(error) {
  return error.code === 'EEXIST' || (process.platform === 'win32' && error.code === 'EPERM');
}

async function removeStaleLock(path) {
  let record;
  try {
    const text = await readFile(path, 'utf8');
    try {
      record = JSON.parse(text);
    } catch {
      const pid = Number(text.trim());
      if (!Number.isInteger(pid) || pid <= 0) {
        const lockStat = await stat(path);
        if (Date.now() - lockStat.mtimeMs < 5000) return false;
      }
      record = { pid };
    }
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    return false;
  }
  if (processIsAlive(Number(record?.pid))) return false;
  await rm(path, { force: true });
  return true;
}

export async function acquireFileLock(path, {
  conflictMessage = `lock already held: ${path}`,
  timeoutMs = 0,
  retryMs = 25,
} = {}) {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
      })}\n`);
      return async () => {
        await handle.close();
        await rm(path, { force: true });
      };
    } catch (error) {
      if (!isLockConflict(error)) throw error;
      if (await removeStaleLock(path)) continue;
      if (Date.now() >= deadline) {
        const conflict = new Error(conflictMessage);
        conflict.exitCode = 4;
        throw conflict;
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}
