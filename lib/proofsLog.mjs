import { parseProofJson } from './proof.mjs';

export function parseProofsLog(text) {
  const proofs = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    proofs.push(parseProofJson(trimmed));
  }
  return proofs;
}
