import { hashText, hashDigestError } from './hash.mjs';

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

function parseScalarValue(raw) {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  return unquote(t);
}

export function parseTaskYaml(text) {
  const task = {
    request_id: null,
    capability_id: null,
    requester: null,
    input: null,
    input_hash: null,
    input_ref: null,
    expires: null,
    payment: null,
  };

  let inInputRef = false;
  let inPayment = false;
  const paymentLines = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (inPayment) {
      if (/^\s+\S/.test(line)) {
        paymentLines.push(line);
        continue;
      }
      inPayment = false;
    }

    if (inInputRef) {
      if (trimmed.startsWith('type:')) {
        task.input_ref = task.input_ref || {};
        task.input_ref.type = parseScalarValue(trimmed.slice(5));
        continue;
      }
      if (trimmed.startsWith('value:')) {
        task.input_ref = task.input_ref || {};
        task.input_ref.value = parseScalarValue(trimmed.slice(6));
        continue;
      }
      if (/^\w[\w-]*:/.test(trimmed)) {
        inInputRef = false;
      } else {
        continue;
      }
    }

    if (trimmed.startsWith('request_id:')) {
      task.request_id = parseScalarValue(trimmed.slice(11));
      continue;
    }
    if (trimmed.startsWith('capability_id:')) {
      task.capability_id = parseScalarValue(trimmed.slice(14));
      continue;
    }
    if (trimmed.startsWith('requester:')) {
      task.requester = parseScalarValue(trimmed.slice(10));
      continue;
    }
    if (trimmed.startsWith('input_hash:')) {
      task.input_hash = parseScalarValue(trimmed.slice(11));
      continue;
    }
    if (trimmed.startsWith('input:')) {
      task.input = parseScalarValue(trimmed.slice(6));
      continue;
    }
    if (trimmed === 'input_ref:') {
      inInputRef = true;
      task.input_ref = {};
      continue;
    }
    if (trimmed.startsWith('expires:')) {
      task.expires = parseScalarValue(trimmed.slice(8));
      continue;
    }
    if (trimmed === 'payment:') {
      inPayment = true;
      paymentLines.length = 0;
      continue;
    }
  }

  if (paymentLines.length > 0) {
    task.payment = parsePaymentBlock(paymentLines.join('\n'));
  }

  if (task.input_ref && !task.input_ref.type && !task.input_ref.value) {
    task.input_ref = null;
  }

  return task;
}

function parsePaymentBlock(block) {
  const payment = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let val = trimmed.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    payment[key] = val;
  }
  return Object.keys(payment).length ? payment : null;
}

export function validateTaskYaml(task, options = {}) {
  const errors = [];
  const { payment_required = false, capability_ids = null } = options;

  if (!task.request_id) errors.push('missing request_id');
  if (!task.capability_id) errors.push('missing capability_id');
  if (!task.requester) errors.push('missing requester');

  const inputCount = [task.input, task.input_hash, task.input_ref].filter(Boolean).length;
  if (inputCount === 0) errors.push('missing input: one of input, input_hash, or input_ref required');
  if (inputCount > 1) errors.push('ambiguous input: only one of input, input_hash, input_ref allowed');

  if (task.input_hash) {
    const err = hashDigestError(task.input_hash, 'input_hash');
    if (err) errors.push(err);
  }

  if (task.input_ref) {
    if (task.input_ref.type !== 'url') errors.push('input_ref.type must be url');
    if (!task.input_ref.value) errors.push('input_ref.value required');
  }

  if (task.expires) {
    const d = Date.parse(task.expires);
    if (Number.isNaN(d)) errors.push('invalid expires: expected ISO 8601');
  }

  if (payment_required && !task.payment) {
    errors.push('missing payment: node requires payment_required');
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
  if (task.input) return hashText(task.input);
  if (task.input_ref?.type === 'url' && task.input_ref.value) {
    return hashText(task.input_ref.value);
  }
  throw new Error('cannot resolve input hash: no input field');
}

export function serializeTaskYaml(task) {
  const lines = [
    `request_id: ${task.request_id}`,
    `capability_id: ${task.capability_id}`,
    `requester: ${task.requester}`,
  ];

  if (task.input != null) {
    lines.push(`input: "${String(task.input).replace(/"/g, '\\"')}"`);
  } else if (task.input_hash) {
    lines.push(`input_hash: ${task.input_hash}`);
  } else if (task.input_ref) {
    lines.push('input_ref:');
    lines.push(`  type: ${task.input_ref.type}`);
    lines.push(`  value: "${String(task.input_ref.value).replace(/"/g, '\\"')}"`);
  }

  if (task.expires) lines.push(`expires: ${task.expires}`);
  if (task.payment) {
    lines.push('payment:');
    for (const [k, v] of Object.entries(task.payment)) {
      const val = typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v;
      lines.push(`  ${k}: ${val}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export const TASK_TITLE_PREFIX = '[task]';

export function taskIssueTitle(capabilityId) {
  return `${TASK_TITLE_PREFIX} ${capabilityId}`;
}

export function isTaskIssue(title) {
  return typeof title === 'string' && title.startsWith(TASK_TITLE_PREFIX);
}
