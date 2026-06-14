import { validateManifest } from './manifest.mjs';
import { validateTask, isExpired, isTaskIssue, taskIssueTitle } from './task.mjs';
import { hasProcessed } from './dedup.mjs';
import { verifyHmacAuthorization } from './authorizationHmac.mjs';
import {
  findCredential,
  findCredentialRedemption,
  verifyCredentialAuthorization,
} from './credential.mjs';

export function validateTaskAcceptance(task, issue, options = {}) {
  const {
    manifest,
    processedIds = null,
    authorizationSecrets = {},
    credentialStore = null,
    redemptions = [],
    now = new Date(),
    checkIssueMeta = false,
  } = options;

  const errors = [];
  const capIds = manifest?.capabilities?.map((capability) => capability.id) || [];
  const authorizationRequired = !!manifest?.profiles?.authorization;
  const capability = manifest?.capabilities?.find((item) => item.id === task?.capability_id);
  const credentialRequired = capability?.access?.mode === 'credential';

  errors.push(...validateManifest(manifest, { requireGithubProfile: true }));
  errors.push(...validateTask(task, {
    capability_ids: capIds,
    authorization_required: authorizationRequired,
    credential_required: credentialRequired,
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
  if (authorizationRequired || task?.authorization) {
    try {
      authorizationResult = verifyHmacAuthorization(
        task,
        task.authorization,
        authorizationSecrets.hmacKeys,
        now,
      );
    } catch (error) {
      authorizationResult = {
        ok: false,
        reason: `invalid authorization binding: ${error.message}`,
      };
    }
    if (!authorizationResult.ok) errors.push(authorizationResult.reason);
  }

  let credentialResult = { ok: true, reason: null };
  if (credentialRequired || task?.credential) {
    try {
      const record = findCredential(credentialStore || { credentials: [] }, task?.credential?.credential_id);
      credentialResult = verifyCredentialAuthorization(task, manifest, task?.credential, record, now);
      if (credentialResult.ok) {
        const redemption = findCredentialRedemption(redemptions, task.credential.credential_id);
        if (redemption && redemption.request_id !== task.request_id) {
          credentialResult = { ok: false, reason: 'credential already redeemed' };
        }
      }
    } catch (error) {
      credentialResult = {
        ok: false,
        reason: `invalid credential binding: ${error.message}`,
      };
    }
    if (!credentialResult.ok) errors.push(credentialResult.reason);
  }

  return {
    errors,
    authorization_ok: authorizationResult.ok,
    authorization_error: authorizationResult.reason,
    credential_ok: credentialResult.ok,
    credential_error: credentialResult.reason,
    credential_digest: credentialResult.credential_digest || null,
    task_intent_digest: credentialResult.task_intent_digest || null,
  };
}
