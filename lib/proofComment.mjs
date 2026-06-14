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

export function isTrustedProofAuthor(comment) {
  return ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment?.author_association)
    || comment?.performed_via_github_app != null;
}

export function verifyProofBinding(proof, task, inputHash) {
  const errors = [];
  if (!proof) return { ok: false, errors: ['missing proof'] };
  if (proof.request_id !== task.request_id) errors.push('proof request_id does not match task');
  if (proof.capability_id !== task.capability_id) errors.push('proof capability_id does not match task');
  if (proof.input_hash !== inputHash) errors.push('proof input_hash does not match task');
  return { ok: errors.length === 0, errors };
}

export function extractBoundProofFromComments(comments, task, inputHash, options = {}) {
  const { requireTrustedAuthor = true } = options;
  if (!Array.isArray(comments)) return { proof: null, comment: null, errors: ['no comments'] };
  const sorted = [...comments].sort((a, b) => {
    const ta = Date.parse(a.created_at || '') || 0;
    const tb = Date.parse(b.created_at || '') || 0;
    return tb - ta;
  });
  const errors = [];
  for (const comment of sorted) {
    const proof = extractProofFromCommentBody(comment.body || '');
    if (!proof) continue;
    if (requireTrustedAuthor && !isTrustedProofAuthor(comment)) {
      errors.push(`proof comment ${comment.id ?? 'unknown'} has untrusted author`);
      continue;
    }
    const binding = verifyProofBinding(proof, task, inputHash);
    if (!binding.ok) {
      errors.push(...binding.errors);
      continue;
    }
    return { proof, comment, errors };
  }
  return { proof: null, comment: null, errors };
}
