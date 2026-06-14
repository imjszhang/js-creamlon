import { parseDocument } from 'yaml';
import { PROTOCOL_VERSION } from './protocol.mjs';

const AGENT_KEYS = new Set(['name', 'description', 'creamlon']);
const CREAMLON_KEYS = new Set([
  'version',
  'public_key',
  'capabilities',
  'payment_instructions',
  'status',
]);
const CAPABILITY_KEYS = new Set(['id', 'description', 'input_types', 'output_types']);
const STATUSES = new Set(['available', 'busy', 'offline']);

function stringArray(value) {
  if (!Array.isArray(value)) return value == null ? [] : null;
  return value.map((item) => String(item));
}

export function parseAgentYaml(text) {
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
    throw new Error('invalid agent.yaml: exceeds 65536 bytes');
  }
  const doc = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: true,
  });
  if (doc.errors.length) {
    throw new Error(`invalid agent.yaml: ${doc.errors.map((e) => e.message).join('; ')}`);
  }
  const raw = doc.toJS({ maxAliasCount: 0 });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid agent.yaml: expected a mapping');
  }
  const c = raw.creamlon && typeof raw.creamlon === 'object' && !Array.isArray(raw.creamlon)
    ? raw.creamlon
    : null;
  return {
    name: raw.name == null ? null : String(raw.name),
    description: raw.description == null ? null : String(raw.description),
    creamlon: c
      ? {
          version: c.version == null ? null : String(c.version),
          public_key: c.public_key == null ? null : String(c.public_key),
          capabilities: Array.isArray(c.capabilities)
            ? c.capabilities.map((cap) => ({
                id: cap?.id == null ? null : String(cap.id),
                description: cap?.description == null ? null : String(cap.description),
                input_types: stringArray(cap?.input_types),
                output_types: stringArray(cap?.output_types),
                _unknown_keys: cap && typeof cap === 'object'
                  ? Object.keys(cap).filter((key) => !CAPABILITY_KEYS.has(key))
                  : [],
              }))
            : [],
          payment_instructions: c.payment_instructions == null ? null : String(c.payment_instructions),
          status: c.status == null ? null : String(c.status),
          _unknown_keys: Object.keys(c).filter((key) => !CREAMLON_KEYS.has(key)),
        }
      : null,
    _unknown_keys: Object.keys(raw).filter((key) => !AGENT_KEYS.has(key)),
  };
}

export function validateAgentYaml(parsed) {
  const errors = [];
  if (!parsed?.name) errors.push('missing name');
  if (parsed?._unknown_keys?.length) errors.push(`unknown agent fields: ${parsed._unknown_keys.join(', ')}`);
  if (!parsed?.creamlon) {
    errors.push('missing creamlon block');
  } else {
    const c = parsed.creamlon;
    if (!c.version) errors.push('missing creamlon.version');
    else if (c.version !== PROTOCOL_VERSION) errors.push(`unsupported creamlon.version: ${c.version}`);
    if (!c.public_key) errors.push('missing creamlon.public_key');
    else if (!/^[A-Za-z0-9_-]{43}$/.test(c.public_key)) {
      errors.push('invalid creamlon.public_key');
    }
    if (!c.capabilities?.length) errors.push('missing creamlon.capabilities');
    if (!c.status) errors.push('missing creamlon.status');
    else if (!STATUSES.has(c.status)) errors.push(`invalid creamlon.status: ${c.status}`);
    for (const cap of c.capabilities || []) {
      if (!cap.id) errors.push('capability missing id');
      if (!Array.isArray(cap.input_types) || cap.input_types.length === 0) {
        errors.push(`capability ${cap.id || '<unknown>'} missing input_types`);
      }
      if (!Array.isArray(cap.output_types) || cap.output_types.length === 0) {
        errors.push(`capability ${cap.id || '<unknown>'} missing output_types`);
      }
      if (cap._unknown_keys?.length) errors.push(`unknown capability fields: ${cap._unknown_keys.join(', ')}`);
    }
    if (new Set((c.capabilities || []).map((cap) => cap.id)).size !== (c.capabilities || []).length) {
      errors.push('duplicate capability id');
    }
    if (!c.payment_instructions) errors.push('missing creamlon.payment_instructions');
    if (c._unknown_keys?.length) errors.push(`unknown creamlon fields: ${c._unknown_keys.join(', ')}`);
  }
  return errors;
}

let transportFetch = globalThis.fetch;

export function setAgentFetch(fn) {
  transportFetch = fn;
}

export async function fetchAgentYaml(owner, repo, ref = 'main') {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/agent.yaml`;
  const res = await transportFetch(url);
  if (!res.ok) {
    const hint = res.status === 404
      ? ' (try --ref master if the default branch is not main)'
      : '';
    throw new Error(`failed to fetch agent.yaml (${res.status}): ${url}${hint}`);
  }
  const text = await res.text();
  return { text, parsed: parseAgentYaml(text), url };
}

export function parseRepoSlug(slug) {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error(`invalid repo slug "${slug}", expected owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}
