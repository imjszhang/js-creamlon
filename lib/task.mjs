import { parseDocument, stringify } from 'yaml';
import { hashText, hashDigestError } from './hash.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';

const TASK_KEYS = new Set([
  'version',
  'request_id',
  'capability_id',
  'requester',
  'input',
  'expires',
  'authorization',
  'credential',
]);
const INPUT_KEYS = new Set(['media_type', 'value', 'url', 'digest']);
const AUTHORIZATION_KEYS = new Set(['scheme', 'key_id', 'expires', 'signature']);
const CREDENTIAL_KEYS = new Set(['scheme', 'credential_id', 'authorization']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUESTER_RE = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function parseTask(text) {
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw new Error('task exceeds 65536 bytes');
  const doc = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: true,
  });
  if (doc.errors.length) throw new Error(`invalid task: ${doc.errors.map((error) => error.message).join('; ')}`);
  const raw = doc.toJS({ maxAliasCount: 0 });
  if (!object(raw)) throw new Error('invalid task: expected a mapping');
  const input = object(raw.input);
  const authorization = object(raw.authorization);
  const credential = object(raw.credential);
  return {
    version: raw.version == null ? null : String(raw.version),
    request_id: raw.request_id == null ? null : String(raw.request_id),
    capability_id: raw.capability_id == null ? null : String(raw.capability_id),
    requester: raw.requester == null ? null : String(raw.requester),
    input: input
      ? {
          media_type: input.media_type == null ? null : String(input.media_type),
          value: input.value == null ? null : String(input.value),
          url: input.url == null ? null : String(input.url),
          digest: input.digest == null ? null : String(input.digest),
          _unknown_keys: Object.keys(input).filter((key) => !INPUT_KEYS.has(key)),
        }
      : null,
    expires: raw.expires == null ? null : String(raw.expires),
    authorization: authorization
      ? {
          scheme: authorization.scheme == null ? null : String(authorization.scheme),
          key_id: authorization.key_id == null ? null : String(authorization.key_id),
          expires: authorization.expires == null ? null : String(authorization.expires),
          signature: authorization.signature == null ? null : String(authorization.signature),
          _unknown_keys: Object.keys(authorization).filter((key) => !AUTHORIZATION_KEYS.has(key)),
        }
      : null,
    credential: credential
      ? {
          scheme: credential.scheme == null ? null : String(credential.scheme),
          credential_id: credential.credential_id == null ? null : String(credential.credential_id),
          authorization: credential.authorization == null ? null : String(credential.authorization),
          _unknown_keys: Object.keys(credential).filter((key) => !CREDENTIAL_KEYS.has(key)),
        }
      : null,
    _unknown_keys: Object.keys(raw).filter((key) => !TASK_KEYS.has(key)),
  };
}

export function validateTask(task, options = {}) {
  const { capability_ids = null, authorization_required = false, credential_required = false } = options;
  const errors = [];
  if (task?.version !== PROTOCOL_VERSION) errors.push(`unsupported version: ${task?.version || '<missing>'}`);
  if (!task?.request_id || !ID_RE.test(task.request_id)) errors.push('invalid request_id');
  if (!task?.capability_id || !ID_RE.test(task.capability_id)) errors.push('invalid capability_id');
  if (!task?.requester || !REQUESTER_RE.test(task.requester)) {
    errors.push('invalid requester: expected github:owner/repo');
  }
  if (!task?.input) {
    errors.push('missing input');
  } else {
    if (!task.input.media_type) errors.push('missing input.media_type');
    const locations = [
      task.input.value != null,
      !!task.input.url,
      !!task.input.digest,
    ].filter(Boolean).length;
    if (locations !== 1) errors.push('input requires exactly one of value, url, or digest');
    if (task.input.value != null && Buffer.byteLength(task.input.value, 'utf8') > 48 * 1024) {
      errors.push('input.value exceeds 49152 bytes');
    }
    if (task.input.url) {
      try {
        const url = new URL(task.input.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
      } catch {
        errors.push('input.url must be an http(s) URL');
      }
    }
    if (task.input.digest) {
      const error = hashDigestError(task.input.digest, 'input.digest');
      if (error) errors.push(error);
    }
    if (task.input._unknown_keys?.length) {
      errors.push(`unknown input fields: ${task.input._unknown_keys.join(', ')}`);
    }
  }
  if (task?.expires && (!ISO_WITH_ZONE_RE.test(task.expires) || Number.isNaN(Date.parse(task.expires)))) {
    errors.push('invalid expires: expected ISO 8601 with timezone');
  }
  if (authorization_required && !task?.authorization) errors.push('missing authorization');
  if (task?.authorization) {
    if (task.authorization.scheme !== 'hmac-sha256') {
      errors.push('authorization.scheme must be hmac-sha256');
    }
    if (!task.authorization.key_id) errors.push('missing authorization.key_id');
    if (!task.authorization.expires
      || !ISO_WITH_ZONE_RE.test(task.authorization.expires)
      || Number.isNaN(Date.parse(task.authorization.expires))) {
      errors.push('invalid authorization.expires');
    }
    if (!task.authorization.signature) errors.push('missing authorization.signature');
    if (task.authorization._unknown_keys?.length) {
      errors.push(`unknown authorization fields: ${task.authorization._unknown_keys.join(', ')}`);
    }
  }
  if (credential_required && !task?.credential) errors.push('missing credential');
  if (task?.credential) {
    if (task.credential.scheme !== 'voucher-hmac-v1') {
      errors.push('credential.scheme must be voucher-hmac-v1');
    }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(task.credential.credential_id || '')) {
      errors.push('invalid credential.credential_id');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(task.credential.authorization || '')) {
      errors.push('invalid credential.authorization');
    }
    if (task.credential._unknown_keys?.length) {
      errors.push(`unknown credential fields: ${task.credential._unknown_keys.join(', ')}`);
    }
    if (!task.expires) errors.push('credential task requires expires');
  }
  if (task?._unknown_keys?.length) errors.push(`unknown task fields: ${task._unknown_keys.join(', ')}`);
  if (capability_ids && task?.capability_id && !capability_ids.includes(task.capability_id)) {
    errors.push(`unknown capability_id: ${task.capability_id}`);
  }
  return errors;
}

export function isExpired(task, now = new Date()) {
  return !!task?.expires && Date.parse(task.expires) < now.getTime();
}

export function resolveInputDigest(task) {
  if (task.input?.digest) return task.input.digest;
  if (task.input?.value != null) return hashText(task.input.value);
  if (task.input?.url) return hashText(task.input.url);
  throw new Error('cannot resolve input digest');
}

export function serializeTask(task) {
  const value = {
    version: task.version,
    request_id: task.request_id,
    capability_id: task.capability_id,
    requester: task.requester,
    input: {
      media_type: task.input.media_type,
      ...(task.input.value != null ? { value: task.input.value } : {}),
      ...(task.input.url ? { url: task.input.url } : {}),
      ...(task.input.digest ? { digest: task.input.digest } : {}),
    },
  };
  if (task.expires) value.expires = task.expires;
  if (task.authorization) value.authorization = task.authorization;
  if (task.credential) value.credential = task.credential;
  return stringify(value, { lineWidth: 0 });
}

export const TASK_TITLE_PREFIX = '[task]';

export function taskIssueTitle(capabilityId) {
  return `${TASK_TITLE_PREFIX} ${capabilityId}`;
}

export function isTaskIssue(title) {
  return typeof title === 'string' && title.startsWith(`${TASK_TITLE_PREFIX} `);
}
