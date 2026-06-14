import { validateManifest } from './manifest.mjs';
import { validateTask, isExpired, isTaskIssue, taskIssueTitle } from './task.mjs';
import { hasProcessed } from './dedup.mjs';
import { verifyHmacAuthorization } from './authorizationHmac.mjs';

export function validateTaskAcceptance(task, issue, options = {}) {
  const {
    manifest,
    processedIds = null,
    authorizationSecrets = {},
    now = new Date(),
    checkIssueMeta = false,
  } = options;

  const errors = [];
  const capIds = manifest?.capabilities?.map((capability) => capability.id) || [];
  const authorizationRequired = !!manifest?.profiles?.authorization;

  errors.push(...validateManifest(manifest, { requireGithubProfile: true }));
  errors.push(...validateTask(task, {
    capability_ids: capIds,
    authorization_required: authorizationRequired,
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

  let authorizationResult = { ok: true, reason: null };
  if (authorizationRequired || task.authorization) {
    authorizationResult = verifyHmacAuthorization(
      task,
      task.authorization,
      authorizationSecrets.hmacKeys,
      now,
    );
    if (!authorizationResult.ok) errors.push(authorizationResult.reason);
  }

  return {
    errors,
    authorization_ok: authorizationResult.ok,
    authorization_error: authorizationResult.reason,
  };
}
