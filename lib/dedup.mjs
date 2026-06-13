import { readFile } from 'node:fs/promises';
import { parseProofsLog } from './proofsLog.mjs';

export async function loadProcessedIds(proofsLogPath) {
  try {
    const text = await readFile(proofsLogPath, 'utf8');
    return loadProcessedIdsFromText(text);
  } catch (e) {
    if (e.code === 'ENOENT') return new Set();
    throw e;
  }
}

export function loadProcessedIdsFromText(text) {
  const ids = new Set();
  for (const proof of parseProofsLog(text)) {
    if (proof.request_id) ids.add(proof.request_id);
  }
  return ids;
}

export function hasProcessed(processedSet, requestId) {
  return processedSet.has(requestId);
}
