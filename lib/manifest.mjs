import { parseDocument } from 'yaml';
import { PROTOCOL_VERSION } from './protocol.mjs';
import { parseManifestDelivery, validateManifestDelivery } from './extensions/delivery/schema.mjs';

export const MANIFEST_FILE = 'creamlon.yaml';

const ROOT_KEYS = new Set([
  'version',
  'name',
  'description',
  'identity',
  'status',
  'capabilities',
  'profiles',
  'extensions',
]);
const IDENTITY_KEYS = new Set(['type', 'public_key']);
const CAPABILITY_KEYS = new Set(['id', 'description', 'input', 'output', 'access']);
const IO_KEYS = new Set(['media_types', 'schema']);
const ACCESS_KEYS = new Set(['mode', 'units']);
const GITHUB_PROFILE_KEYS = new Set(['transport']);
const AUTHORIZATION_PROFILE_KEYS = new Set(['scheme', 'instructions']);
const CREDENTIAL_PROFILE_KEYS = new Set(['scheme', 'instructions']);
const STATUSES = new Set(['available', 'busy', 'offline']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseYamlObject(text) {
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
    throw new Error(`invalid ${MANIFEST_FILE}: exceeds 65536 bytes`);
  }
  const doc = parseDocument(text.replace(/^\uFEFF/, ''), {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: true,
  });
  if (doc.errors.length) {
    throw new Error(`invalid ${MANIFEST_FILE}: ${doc.errors.map((error) => error.message).join('; ')}`);
  }
  const raw = doc.toJS({ maxAliasCount: 0 });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`invalid ${MANIFEST_FILE}: expected a mapping`);
  }
  return raw;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseIo(value) {
  const raw = asObject(value);
  return raw
    ? {
        media_types: Array.isArray(raw.media_types)
          ? raw.media_types.map((item) => String(item))
          : [],
        schema: raw.schema == null ? null : String(raw.schema),
        _unknown_keys: Object.keys(raw).filter((key) => !IO_KEYS.has(key)),
      }
    : null;
}

export function parseManifest(text) {
  const raw = parseYamlObject(text);
  const identity = asObject(raw.identity);
  const profiles = asObject(raw.profiles);
  const github = asObject(profiles?.github);
  const authorization = asObject(profiles?.authorization);
  const credential = asObject(profiles?.credential);
  return {
    version: raw.version == null ? null : String(raw.version),
    name: raw.name == null ? null : String(raw.name),
    description: raw.description == null ? null : String(raw.description),
    identity: identity
      ? {
          type: identity.type == null ? null : String(identity.type),
          public_key: identity.public_key == null ? null : String(identity.public_key),
          _unknown_keys: Object.keys(identity).filter((key) => !IDENTITY_KEYS.has(key)),
        }
      : null,
    status: raw.status == null ? null : String(raw.status),
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.map((capability) => ({
          id: capability?.id == null ? null : String(capability.id),
          description: capability?.description == null ? null : String(capability.description),
          input: parseIo(capability?.input),
          output: parseIo(capability?.output),
          access: asObject(capability?.access)
            ? {
                mode: capability.access.mode == null ? null : String(capability.access.mode),
                units: capability.access.units == null ? null : Number(capability.access.units),
                _unknown_keys: Object.keys(capability.access)
                  .filter((key) => !ACCESS_KEYS.has(key)),
              }
            : null,
          _unknown_keys: asObject(capability)
            ? Object.keys(capability).filter((key) => !CAPABILITY_KEYS.has(key))
            : [],
        }))
      : [],
    profiles: profiles
      ? {
          github: github
            ? {
                transport: github.transport == null ? null : String(github.transport),
                _unknown_keys: Object.keys(github).filter((key) => !GITHUB_PROFILE_KEYS.has(key)),
              }
            : null,
          authorization: authorization
            ? {
                scheme: authorization.scheme == null ? null : String(authorization.scheme),
                instructions: authorization.instructions == null
                  ? null
                  : String(authorization.instructions),
                _unknown_keys: Object.keys(authorization)
                  .filter((key) => !AUTHORIZATION_PROFILE_KEYS.has(key)),
              }
            : null,
          credential: credential
            ? {
                scheme: credential.scheme == null ? null : String(credential.scheme),
                instructions: credential.instructions == null
                  ? null
                  : String(credential.instructions),
                _unknown_keys: Object.keys(credential)
                  .filter((key) => !CREDENTIAL_PROFILE_KEYS.has(key)),
              }
            : null,
          _unknown_keys: Object.keys(profiles)
            .filter((key) => !['github', 'authorization', 'credential'].includes(key)),
        }
      : null,
    extensions: raw.extensions == null ? {} : raw.extensions,
    _unknown_keys: Object.keys(raw).filter((key) => !ROOT_KEYS.has(key)),
  };
}

export function validateManifest(manifest, options = {}) {
  const { requireGithubProfile = false } = options;
  const errors = [];
  if (manifest?.version !== PROTOCOL_VERSION) {
    errors.push(`unsupported version: ${manifest?.version || '<missing>'}`);
  }
  if (!manifest?.name) errors.push('missing name');
  if (!manifest?.identity) {
    errors.push('missing identity');
  } else {
    if (manifest.identity.type !== 'ed25519') errors.push('identity.type must be ed25519');
    if (!/^[A-Za-z0-9_-]{43}$/.test(manifest.identity.public_key || '')) {
      errors.push('invalid identity.public_key');
    }
    if (manifest.identity._unknown_keys.length) {
      errors.push(`unknown identity fields: ${manifest.identity._unknown_keys.join(', ')}`);
    }
  }
  if (!STATUSES.has(manifest?.status)) errors.push(`invalid status: ${manifest?.status || '<missing>'}`);
  if (!manifest?.capabilities?.length) errors.push('missing capabilities');
  for (const capability of manifest?.capabilities || []) {
    if (!capability.id || !ID_RE.test(capability.id)) errors.push('invalid capability id');
    if (!capability.input?.media_types?.length) {
      errors.push(`capability ${capability.id || '<unknown>'} missing input.media_types`);
    }
    if (!capability.output?.media_types?.length) {
      errors.push(`capability ${capability.id || '<unknown>'} missing output.media_types`);
    }
    if (capability._unknown_keys.length) {
      errors.push(`unknown capability fields: ${capability._unknown_keys.join(', ')}`);
    }
    if (capability.input?._unknown_keys.length) {
      errors.push(`unknown capability input fields: ${capability.input._unknown_keys.join(', ')}`);
    }
    if (capability.output?._unknown_keys.length) {
      errors.push(`unknown capability output fields: ${capability.output._unknown_keys.join(', ')}`);
    }
    if (capability.access) {
      if (!['free', 'credential'].includes(capability.access.mode)) {
        errors.push(`capability ${capability.id || '<unknown>'} access.mode must be free or credential`);
      }
      if (capability.access.units !== 1) {
        errors.push(`capability ${capability.id || '<unknown>'} access.units must be 1`);
      }
      if (capability.access._unknown_keys.length) {
        errors.push(`unknown capability access fields: ${capability.access._unknown_keys.join(', ')}`);
      }
    }
  }
  if (new Set((manifest?.capabilities || []).map((item) => item.id)).size !== manifest?.capabilities?.length) {
    errors.push('duplicate capability id');
  }
  if (requireGithubProfile && manifest?.profiles?.github?.transport !== 'issues') {
    errors.push('profiles.github.transport must be issues');
  }
  if (manifest?.profiles?.github) {
    if (manifest.profiles.github.transport !== 'issues') {
      errors.push('profiles.github.transport must be issues');
    }
    if (manifest.profiles.github._unknown_keys.length) {
      errors.push(`unknown github profile fields: ${manifest.profiles.github._unknown_keys.join(', ')}`);
    }
  }
  if (manifest?.profiles?.authorization) {
    if (manifest.profiles.authorization.scheme !== 'hmac-sha256') {
      errors.push('profiles.authorization.scheme must be hmac-sha256');
    }
    if (manifest.profiles.authorization._unknown_keys.length) {
      errors.push(
        `unknown authorization profile fields: ${manifest.profiles.authorization._unknown_keys.join(', ')}`,
      );
    }
  }
  if (manifest?.profiles?.credential) {
    if (manifest.profiles.credential.scheme !== 'voucher-hmac-v1') {
      errors.push('profiles.credential.scheme must be voucher-hmac-v1');
    }
    if (manifest.profiles.credential._unknown_keys.length) {
      errors.push(
        `unknown credential profile fields: ${manifest.profiles.credential._unknown_keys.join(', ')}`,
      );
    }
  }
  if ((manifest?.capabilities || []).some((item) => item.access?.mode === 'credential')
    && !manifest?.profiles?.credential) {
    errors.push('credential access requires profiles.credential');
  }
  if (manifest?.profiles?._unknown_keys.length) {
    errors.push(`unsupported profiles: ${manifest.profiles._unknown_keys.join(', ')}`);
  }
  if (!asObject(manifest?.extensions)) errors.push('extensions must be a mapping');
  if (manifest?._unknown_keys.length) errors.push(`unknown manifest fields: ${manifest._unknown_keys.join(', ')}`);
  const manifestDelivery = parseManifestDelivery(manifest);
  if (manifestDelivery) {
    errors.push(...validateManifestDelivery(manifestDelivery));
  }
  return errors;
}

let transportFetch = globalThis.fetch;

export function setManifestFetch(fn) {
  transportFetch = fn;
}

export async function fetchManifest(owner, repo, ref = 'main') {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${MANIFEST_FILE}`;
  const response = await transportFetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${MANIFEST_FILE} (${response.status}): ${url}`);
  }
  const text = await response.text();
  return { text, parsed: parseManifest(text), url };
}

export function parseRepoSlug(slug) {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error(`invalid repo slug "${slug}", expected owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}
