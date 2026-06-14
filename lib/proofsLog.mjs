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

export function findProofByRequestId(proofs, requestId) {
  return proofs.find((proof) => proof.request_id === requestId) || null;
}

export function sameProof(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
