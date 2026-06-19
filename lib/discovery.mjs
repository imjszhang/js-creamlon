import { parseManifest, validateManifest } from './manifest.mjs';
import { fetchRepositoryFilePreferred, MANIFEST_FILES, publicTrustFiles } from './nodeLayout.mjs';
import { inspectKeyContinuity, publicKeyAt } from './identity.mjs';
import {
  parseProofJson,
  publicKeyFingerprint,
  publicKeyFromBase64Url,
  verifyProof,
} from './proof.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';

const STATUS_RANK = { available: 0, busy: 1, offline: 2 };

function summarizeProofs(text, keyHistory) {
  if (text == null) {
    return {
      log_status: 'missing',
      proof_count: 0,
      invalid_proof_count: 0,
      last_signed_at: null,
    };
  }
  let proofCount = 0;
  let invalidProofCount = 0;
  let lastSignedAt = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const proof = parseProofJson(trimmed);
      const publicKeyBase64Url = publicKeyAt(keyHistory, proof.completed_at);
      if (!publicKeyBase64Url) throw new Error('no public key for proof timestamp');
      const publicKey = publicKeyFromBase64Url(publicKeyBase64Url);
      const result = verifyProof(proof, publicKey);
      if (!result.ok) {
        invalidProofCount += 1;
        continue;
      }
      proofCount += 1;
      if (!lastSignedAt || Date.parse(proof.completed_at) > Date.parse(lastSignedAt)) {
        lastSignedAt = proof.completed_at;
      }
    } catch {
      invalidProofCount += 1;
    }
  }
  return {
    log_status: invalidProofCount ? 'invalid' : 'valid',
    proof_count: proofCount,
    invalid_proof_count: invalidProofCount,
    last_signed_at: lastSignedAt,
  };
}

function parseHealth(text, now = new Date()) {
  if (text == null) return { status: 'missing', checked_at: null, proofs_valid: null };
  try {
    const value = JSON.parse(text);
    const checkedAt = Date.parse(value.checked_at);
    if (
      value.version !== PROTOCOL_VERSION
      || !['available', 'busy', 'offline'].includes(value.status)
      || typeof value.proofs_valid !== 'boolean'
      || !value.checked_at
      || Number.isNaN(checkedAt)
    ) {
      return { status: 'invalid', checked_at: value.checked_at || null, proofs_valid: null };
    }
    const age = now.getTime() - checkedAt;
    if (age < -5 * 60 * 1000) {
      return { status: 'invalid', checked_at: value.checked_at, proofs_valid: null };
    }
    const stale = age > 24 * 60 * 60 * 1000;
    return {
      status: stale ? 'stale' : 'fresh',
      checked_at: value.checked_at,
      declared_status: value.status,
      proofs_valid: value.proofs_valid,
    };
  } catch {
    return { status: 'invalid', checked_at: null, proofs_valid: null };
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function compareNullableDateDesc(left, right) {
  return (Date.parse(right || '') || 0) - (Date.parse(left || '') || 0);
}

export function sortDiscoveryResults(results, sort = 'default') {
  return [...results].sort((a, b) => {
    if (sort === 'updated') {
      return compareNullableDateDesc(a.updated_at, b.updated_at)
        || a.repo.localeCompare(b.repo);
    }
    return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
      || compareNullableDateDesc(a.updated_at, b.updated_at)
      || a.repo.localeCompare(b.repo);
  });
}

export async function discoverRepositories(repositories, options) {
  const {
    capabilityId,
    inputType,
    outputType,
    status,
    fetchFile,
    sort = 'default',
    limit = 20,
    now = new Date(),
  } = options;
  const skipped = [];

  const candidates = await mapLimit(repositories, 6, async (repository) => {
    const repo = repository.full_name;
    if (
      repository.private
      || repository.visibility === 'private'
      || repository.archived
      || repository.fork
      || repository.disabled
      || repository.has_issues === false
    ) {
      skipped.push({ repo, reason: 'repository not eligible' });
      return null;
    }
    const ref = repository.default_branch || 'main';
    try {
      const { text: manifestText } = await fetchRepositoryFilePreferred(repository, fetchFile, MANIFEST_FILES, ref);
      const manifest = parseManifest(manifestText);
      const errors = validateManifest(manifest, { requireGithubProfile: true });
      if (errors.length) throw new Error(errors.join('; '));
      const capability = manifest.capabilities.find((item) => item.id === capabilityId);
      if (!capability) return null;
      if (!status && manifest.status === 'offline') return null;
      if (status && manifest.status !== status) return null;
      if (inputType && !capability.input.media_types.includes(inputType)) return null;
      if (outputType && !capability.output.media_types.includes(outputType)) return null;

      const [proofsText, rotationsText, healthText] = await Promise.all([
        fetchRepositoryFilePreferred(repository, fetchFile, publicTrustFiles('proofs.log'), ref, { optional: true })
          .then((result) => result.text),
        fetchRepositoryFilePreferred(repository, fetchFile, publicTrustFiles('key-rotations.log'), ref, { optional: true })
          .then((result) => result.text),
        fetchRepositoryFilePreferred(repository, fetchFile, publicTrustFiles('status.json'), ref, { optional: true })
          .then((result) => result.text),
      ]);
      const continuity = inspectKeyContinuity(rotationsText, manifest.identity.public_key);
      const proofs = continuity.status === 'broken'
        ? {
            log_status: 'unverifiable',
            proof_count: 0,
            invalid_proof_count: 0,
            last_signed_at: null,
          }
        : summarizeProofs(proofsText, continuity.history);
      const health = parseHealth(healthText, now);
      if (health.declared_status && health.declared_status !== manifest.status) {
        health.status = 'invalid';
      }
      return {
        repo,
        repo_url: repository.html_url,
        name: manifest.name,
        description: manifest.description,
        status: manifest.status,
        capability,
        public_key_fingerprint: publicKeyFingerprint(manifest.identity.public_key),
        updated_at: repository.updated_at || null,
        stars: repository.stargazers_count || 0,
        signed_proof_count: proofs.proof_count,
        invalid_signed_proof_count: proofs.invalid_proof_count,
        signature_log_status: proofs.log_status,
        last_signed_at: proofs.last_signed_at,
        key_continuity: continuity.status,
        key_rotations: continuity.rotations,
        key_errors: continuity.errors,
        health,
      };
    } catch (error) {
      skipped.push({ repo, reason: error.message });
      return null;
    }
  });

  const results = sortDiscoveryResults(candidates.filter(Boolean), sort).slice(0, limit);
  return {
    capability_id: capabilityId,
    candidate_count: repositories.length,
    result_count: results.length,
    skipped_count: skipped.length,
    results,
    skipped: skipped.sort((a, b) => a.repo.localeCompare(b.repo)),
    note: 'Signature history is self-published and is not used for ranking. Key continuity is trusted only when anchored to a previously saved public key.',
  };
}
