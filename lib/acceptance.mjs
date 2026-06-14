import { validateAgentYaml } from './agentYaml.mjs';
import { validateTaskYaml, isExpired, isTaskIssue } from './taskYaml.mjs';
import { hasProcessed } from './dedup.mjs';
import { verifyPayment } from './payment/index.mjs';

export function validateTaskAcceptance(task, issue, options = {}) {
  const {
    agentParsed,
    processedIds = null,
    paymentSecrets = {},
    now = new Date(),
    checkIssueMeta = false,
  } = options;

  const errors = [];
  const capIds = agentParsed?.creamlon?.capabilities?.map((c) => c.id) || [];
  const paymentRequired = agentParsed?.creamlon?.payment_required === true;

  errors.push(...validateAgentYaml(agentParsed));
  errors.push(...validateTaskYaml(task, {
    payment_required: paymentRequired,
    capability_ids: capIds,
  }));

  if (processedIds && task.request_id && hasProcessed(processedIds, task.request_id)) {
    errors.push('duplicate request_id in proofs.log');
  }
  if (isExpired(task, now)) {
    errors.push('task expired');
  }

  if (checkIssueMeta && issue) {
    if (!isTaskIssue(issue.title)) {
      errors.push('issue title is not a [task] issue');
    }
    if (issue.state && issue.state !== 'open') {
      errors.push(`issue is not open (state: ${issue.state})`);
    }
  }

  const paymentResult = verifyPayment(task, agentParsed, paymentSecrets);
  if (!paymentResult.ok) {
    errors.push(paymentResult.reason);
  }

  return {
    errors,
    payment_ok: paymentResult.ok,
    payment_error: paymentResult.reason,
  };
}

export function validateSubmitPaymentBinding(task) {
  const errors = [];
  if (!task.payment) return errors;
  if (task.payment.request_id && task.payment.request_id !== task.request_id) {
    errors.push('payment.request_id does not match task request_id');
  }
  return errors;
}
