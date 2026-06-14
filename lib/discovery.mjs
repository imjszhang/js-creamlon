import { parseAgentYaml, validateAgentYaml } from './agentYaml.mjs';
import { verifyKeyContinuity } from './identity.mjs';
import {
  parseProofJson,
  publicKeyFingerprint,
  publicKeyFromBase64Url,
  verifyProof,
} from './proof.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';

const STATUS_RANK = { available: 0, busy: 1, offline: 2 };

function summarizeProofs(text, publicKeyBase64Url) {
  if (text == null) {
    return {
      log_status: 'missing',
      proof_count: 0,
      invalid_proof_count: 0,
      last_delivery_at: null,
    };
  }
  const publicKey = publicKeyFromBase64Url(publicKeyBase64Url);
  let proofCount = 0;
  let invalidProofCount = 0;
  let lastDeliveryAt = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const proof = parseProofJson(trimmed);
      const result = verifyProof(proof, publicKey);
      if (!result.ok) {
        invalidProofCount += 1;
        continue;
      }
      proofCount += 1;
      if (!lastDeliveryAt || Date.parse(proof.completed_at) > Date.parse(lastDeliveryAt)) {
        lastDeliveryAt = proof.completed_at;
      }
    } catch {
      invalidProofCount += 1;
    }
  }
  return {
    log_status: invalidProofCount ? 'invalid' : 'valid',
    proof_count: proofCount,
    invalid_proof_count: invalidProofCount,
    last_delivery_at: lastDeliveryAt,
  };
}

function parseHealth(text, now = new Date()) {
  if (text == null) return { status: 'missing', checked_at: null, proofs_valid: null };
  try {
    const value = JSON.parse(text);
    const checkedAt = Date.parse(value.checked_at);
    if (
      value.v !== PROTOCOL_VERSION
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
    if (sort === 'recent') {
      return compareNullableDateDesc(a.last_delivery_at, b.last_delivery_at)
        || a.repo.localeCompare(b.repo);
    }
    if (sort === 'proofs') {
      return b.proof_count - a.proof_count
        || compareNullableDateDesc(a.last_delivery_at, b.last_delivery_at)
        || a.repo.localeCompare(b.repo);
    }
    if (sort === 'updated') {
      return compareNullableDateDesc(a.updated_at, b.updated_at)
        || a.repo.localeCompare(b.repo);
    }
    return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
      || Number(b.proof_log_status === 'valid') - Number(a.proof_log_status === 'valid')
      || compareNullableDateDesc(a.last_delivery_at, b.last_delivery_at)
      || b.proof_count - a.proof_count
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
    if (repository.archived || repository.fork || repository.disabled || repository.has_issues === false) {
      skipped.push({ repo, reason: 'repository not eligible' });
      return null;
    }
    const ref = repository.default_branch || 'main';
    try {
      const agentText = await fetchFile(repository, 'agent.yaml', ref, false);
      const agent = parseAgentYaml(agentText);
      const errors = validateAgentYaml(agent);
      if (errors.length) throw new Error(errors.join('; '));
      const capability = agent.creamlon.capabilities.find((item) => item.id === capabilityId);
      if (!capability) return null;
      if (!status && agent.creamlon.status === 'offline') return null;
      if (status && agent.creamlon.status !== status) return null;
      if (inputType && !capability.input_types.includes(inputType)) return null;
      if (outputType && !capability.output_types.includes(outputType)) return null;

      const [proofsText, rotationsText, healthText] = await Promise.all([
        fetchFile(repository, 'trust/proofs.log', ref, true),
        fetchFile(repository, 'trust/key-rotations.log', ref, true),
        fetchFile(repository, 'trust/status.json', ref, true),
      ]);
      const proofs = summarizeProofs(proofsText, agent.creamlon.public_key);
      const continuity = verifyKeyContinuity(rotationsText, agent.creamlon.public_key);
      const health = parseHealth(healthText, now);
      if (health.declared_status && health.declared_status !== agent.creamlon.status) {
        health.status = 'invalid';
      }
      return {
        repo,
        repo_url: repository.html_url,
        name: agent.name,
        description: agent.description,
        status: agent.creamlon.status,
        capability,
        public_key_fingerprint: publicKeyFingerprint(agent.creamlon.public_key),
        updated_at: repository.updated_at || null,
        stars: repository.stargazers_count || 0,
        proof_count: proofs.proof_count,
        invalid_proof_count: proofs.invalid_proof_count,
        proof_log_status: proofs.log_status,
        last_delivery_at: proofs.last_delivery_at,
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
    note: 'Proofs verify delivery signatures and task binding; they do not measure output quality.',
  };
}
