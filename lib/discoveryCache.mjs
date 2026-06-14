import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readDiscoveryCache(path, key, ttlMs) {
  try {
    const cache = JSON.parse(await readFile(path, 'utf8'));
    const entry = cache[key];
    const createdAt = Date.parse(entry?.created_at);
    const age = Date.now() - createdAt;
    if (!entry || Number.isNaN(createdAt) || age < 0 || age > ttlMs) return null;
    return entry.value;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeDiscoveryCache(path, key, value) {
  let cache = {};
  try {
    cache = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  cache[key] = { created_at: new Date().toISOString(), value };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}
