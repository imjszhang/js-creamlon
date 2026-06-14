import { validateAgentYaml } from './agentYaml.mjs';
import { validateTaskYaml, isExpired, isTaskIssue, taskIssueTitle } from './taskYaml.mjs';
import { hasProcessed } from './dedup.mjs';
import { verifyHmacPayment } from './payment.mjs';

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

  errors.push(...validateAgentYaml(agentParsed));
  errors.push(...validateTaskYaml(task, {
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
    } else if (task.capability_id && issue.title !== taskIssueTitle(task.capability_id)) {
      errors.push('issue title capability does not match task capability_id');
    }
    if (issue.state && issue.state !== 'open') {
      errors.push(`issue is not open (state: ${issue.state})`);
    }
  }

  const paymentResult = verifyHmacPayment(task, task.payment, paymentSecrets.hmacKeys, now);
  if (!paymentResult.ok) {
    errors.push(paymentResult.reason);
  }

  return {
    errors,
    payment_ok: paymentResult.ok,
    payment_error: paymentResult.reason,
  };
}
