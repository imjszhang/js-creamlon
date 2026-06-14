import { parseDocument, stringify } from 'yaml';
import { hashText, hashDigestError } from './hash.mjs';

const TASK_KEYS = new Set([
  'request_id',
  'capability_id',
  'requester',
  'input',
  'input_hash',
  'input_ref',
  'expires',
  'payment',
]);
const INPUT_REF_KEYS = new Set(['type', 'value']);
const PAYMENT_KEYS = new Set(['key_id', 'expires', 'signature']);
const MAX_TASK_BYTES = 64 * 1024;
const MAX_INPUT_BYTES = 48 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUESTER_RE = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseYamlObject(text, label) {
  if (Buffer.byteLength(text, 'utf8') > MAX_TASK_BYTES) {
    throw new Error(`${label} exceeds ${MAX_TASK_BYTES} bytes`);
  }
  const doc = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: true,
  });
  if (doc.errors.length) {
    throw new Error(`invalid ${label}: ${doc.errors.map((e) => e.message).join('; ')}`);
  }
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid ${label}: expected a mapping`);
  }
  return value;
}

function asStringOrNull(value) {
  return value == null ? null : String(value);
}

export function parseTaskYaml(text) {
  const raw = parseYamlObject(text, 'task YAML');
  const inputRef = raw.input_ref && typeof raw.input_ref === 'object' && !Array.isArray(raw.input_ref)
    ? {
        type: asStringOrNull(raw.input_ref.type),
        value: asStringOrNull(raw.input_ref.value),
      }
    : raw.input_ref ?? null;

  return {
    request_id: asStringOrNull(raw.request_id),
    capability_id: asStringOrNull(raw.capability_id),
    requester: asStringOrNull(raw.requester),
    input: raw.input == null ? null : String(raw.input),
    input_hash: asStringOrNull(raw.input_hash),
    input_ref: inputRef,
    expires: asStringOrNull(raw.expires),
    payment: raw.payment ?? null,
    _unknown_keys: Object.keys(raw).filter((key) => !TASK_KEYS.has(key)),
    _input_ref_unknown_keys: inputRef && typeof raw.input_ref === 'object'
      ? Object.keys(raw.input_ref).filter((key) => !INPUT_REF_KEYS.has(key))
      : [],
  };
}

export function validateTaskYaml(task, options = {}) {
  const errors = [];
  const { capability_ids = null } = options;

  if (!task.request_id) errors.push('missing request_id');
  else if (!ID_RE.test(task.request_id)) errors.push('invalid request_id');
  if (!task.capability_id) errors.push('missing capability_id');
  else if (!ID_RE.test(task.capability_id)) errors.push('invalid capability_id');
  if (!task.requester) errors.push('missing requester');
  else if (!REQUESTER_RE.test(task.requester)) errors.push('invalid requester: expected github:owner/repo');

  const inputCount = [task.input != null, !!task.input_hash, !!task.input_ref].filter(Boolean).length;
  if (inputCount === 0) errors.push('missing input: one of input, input_hash, or input_ref required');
  if (inputCount > 1) errors.push('ambiguous input: only one of input, input_hash, input_ref allowed');
  if (task.input != null && Buffer.byteLength(task.input, 'utf8') > MAX_INPUT_BYTES) {
    errors.push(`input exceeds ${MAX_INPUT_BYTES} bytes`);
  }

  if (task.input_hash) {
    const err = hashDigestError(task.input_hash, 'input_hash');
    if (err) errors.push(err);
  }

  if (task.input_ref) {
    if (typeof task.input_ref !== 'object' || Array.isArray(task.input_ref)) {
      errors.push('input_ref must be a mapping');
    } else {
      if (task.input_ref.type !== 'url') errors.push('input_ref.type must be url');
      if (!task.input_ref.value) errors.push('input_ref.value required');
      else {
        try {
          const url = new URL(task.input_ref.value);
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
        } catch {
          errors.push('input_ref.value must be an http(s) URL');
        }
      }
    }
  }

  if (task.expires) {
    if (!ISO_WITH_ZONE_RE.test(task.expires) || Number.isNaN(Date.parse(task.expires))) {
      errors.push('invalid expires: expected ISO 8601 with timezone');
    }
  }

  if (!task.payment) errors.push('missing payment');
  if (task.payment != null && (typeof task.payment !== 'object' || Array.isArray(task.payment))) {
    errors.push('payment must be a mapping');
  } else if (task.payment) {
    const unknown = Object.keys(task.payment).filter((key) => !PAYMENT_KEYS.has(key));
    if (unknown.length) errors.push(`unknown payment fields: ${unknown.join(', ')}`);
    if (!task.payment.key_id) errors.push('missing payment.key_id');
    if (!task.payment.signature) errors.push('missing payment.signature');
    if (!task.payment.expires) {
      errors.push('missing payment.expires');
    } else if (!ISO_WITH_ZONE_RE.test(task.payment.expires) || Number.isNaN(Date.parse(task.payment.expires))) {
      errors.push('invalid payment.expires: expected ISO 8601 with timezone');
    } else if (Date.parse(task.payment.expires) < Date.now()) {
      errors.push('payment expired');
    }
  }
  if (task._unknown_keys?.length) {
    errors.push(`unknown task fields: ${task._unknown_keys.join(', ')}`);
  }
  if (task._input_ref_unknown_keys?.length) {
    errors.push(`unknown input_ref fields: ${task._input_ref_unknown_keys.join(', ')}`);
  }
  if (capability_ids && task.capability_id && !capability_ids.includes(task.capability_id)) {
    errors.push(`unknown capability_id: ${task.capability_id}`);
  }

  return errors;
}

export function isExpired(task, now = new Date()) {
  if (!task.expires) return false;
  const d = Date.parse(task.expires);
  if (Number.isNaN(d)) return false;
  return d < now.getTime();
}

export function resolveInputHash(task) {
  if (task.input_hash) return task.input_hash;
  if (task.input != null) return hashText(task.input);
  if (task.input_ref?.type === 'url' && task.input_ref.value) {
    return hashText(task.input_ref.value);
  }
  throw new Error('cannot resolve input hash: no input field');
}

export function serializeTaskYaml(task) {
  const value = {
    request_id: task.request_id,
    capability_id: task.capability_id,
    requester: task.requester,
  };
  if (task.input != null) value.input = task.input;
  else if (task.input_hash) value.input_hash = task.input_hash;
  else if (task.input_ref) value.input_ref = task.input_ref;
  if (task.expires) value.expires = task.expires;
  if (task.payment) value.payment = task.payment;
  return stringify(value, { lineWidth: 0 });
}

export const TASK_TITLE_PREFIX = '[task]';

export function taskIssueTitle(capabilityId) {
  return `${TASK_TITLE_PREFIX} ${capabilityId}`;
}

export function isTaskIssue(title) {
  return typeof title === 'string' && title.startsWith(`${TASK_TITLE_PREFIX} `);
}
