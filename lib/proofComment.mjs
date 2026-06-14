import { parseProofJson } from './proof.mjs';

const FENCED_JSON_RE = /```json\s*([\s\S]*?)```/gi;

function isProofShape(obj) {
  return obj
    && typeof obj === 'object'
    && typeof obj.v === 'string'
    && typeof obj.sig === 'string'
    && typeof obj.request_id === 'string';
}

export function extractProofFromCommentBody(body) {
  if (!body || typeof body !== 'string') return null;

  const matches = [...body.matchAll(FENCED_JSON_RE)];
  let latest = null;

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = parseProofJson(raw);
      if (isProofShape(parsed)) latest = parsed;
    } catch {
      // skip invalid JSON blocks
    }
  }

  return latest;
}

export function extractProofFromComments(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return null;

  const sorted = [...comments].sort((a, b) => {
    const ta = Date.parse(a.created_at || '') || 0;
    const tb = Date.parse(b.created_at || '') || 0;
    return ta - tb;
  });

  let latest = null;
  for (const comment of sorted) {
    const proof = extractProofFromCommentBody(comment.body || '');
    if (proof) latest = proof;
  }

  return latest;
}
