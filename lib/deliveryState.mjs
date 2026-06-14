import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`);
    return async () => {
      await handle.close();
      await rm(path, { force: true });
    };
  } catch (error) {
    if (error.code === 'EEXIST') {
      const conflict = new Error(`delivery already in progress: ${path}`);
      conflict.exitCode = 4;
      throw conflict;
    }
    throw error;
  }
}
