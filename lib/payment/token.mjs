import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function secureCompare(a, b) {
  const ha = createHash('sha256').update(String(a), 'utf8').digest();
  const hb = createHash('sha256').update(String(b), 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export async function loadPaymentTokens({ explicit, env, filePath } = {}) {
  const tokens = new Set();

  if (explicit) {
    for (const t of String(explicit).split(',').map((s) => s.trim()).filter(Boolean)) {
      tokens.add(t);
    }
  }

  const envToken = env ?? process.env.CREAMLON_PAYMENT_TOKEN;
  if (envToken) {
    for (const t of String(envToken).split(',').map((s) => s.trim()).filter(Boolean)) {
      tokens.add(t);
    }
  }

  if (filePath) {
    try {
      const text = await readFile(filePath, 'utf8');
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) tokens.add(t);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  return tokens;
}

export function verifyTokenPayment(task, payment, validTokens) {
  if (!payment) {
    return { ok: false, reason: 'missing payment: node requires payment' };
  }
  if (payment.type !== 'token') {
    return { ok: false, reason: 'invalid payment.type: expected token' };
  }
  if (!payment.token) {
    return { ok: false, reason: 'missing payment.token' };
  }
  if (!payment.request_id) {
    return { ok: false, reason: 'missing payment.request_id' };
  }
  if (payment.request_id !== task.request_id) {
    return { ok: false, reason: 'payment.request_id does not match task request_id' };
  }
  if (!validTokens || validTokens.size === 0) {
    return { ok: false, reason: 'payment token not configured on node' };
  }

  for (const valid of validTokens) {
    if (secureCompare(payment.token, valid)) {
      return { ok: true, reason: null };
    }
  }

  return { ok: false, reason: 'invalid payment token' };
}
