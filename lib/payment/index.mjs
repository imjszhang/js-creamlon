import { verifyTokenPayment } from './token.mjs';

export function paymentRequired(agentParsed) {
  return agentParsed?.creamlon?.payment_required === true;
}

export function verifyPayment(task, agentParsed, secrets = {}) {
  const paymentType = agentParsed?.creamlon?.payment?.type || 'token';
  const required = paymentRequired(agentParsed);

  if (!required && !task.payment) {
    return { ok: true, reason: null };
  }

  if (paymentType !== 'token') {
    return { ok: false, reason: `unsupported payment.type: ${paymentType} (v0.3 supports token only)` };
  }

  return verifyTokenPayment(task, task.payment, secrets.tokens);
}
