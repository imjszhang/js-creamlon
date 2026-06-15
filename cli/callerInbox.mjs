import { createHash } from 'node:crypto';
import {
  addRepositoryCollaborator,
  createPrivateRepository,
  ensureInboxRuleset,
  getAuthenticatedUser,
  getBranchRules,
  getRepository,
  getRepositoryCollaboratorPermission,
  getUser,
  removeRepositoryCollaborator,
} from '../lib/github.mjs';
import {
  DEFAULT_INBOX_REGISTRY,
  findInbox,
  readInboxRegistry,
  updateInboxRegistry,
  upsertInbox,
} from '../lib/inboxRegistry.mjs';
import { parseGithubRepo } from '../lib/extensions/delivery/transport-github.mjs';
import { parseManifestDelivery } from '../lib/extensions/delivery/schema.mjs';

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 1;
  return error;
}

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function defaultInboxName(node) {
  const name = `creamlon-inbox-${node.replace('/', '-')}`.toLowerCase();
  if (name.length <= 100) return name;
  const suffix = createHash('sha256').update(node).digest('hex').slice(0, 8);
  return `${name.slice(0, 91)}-${suffix}`;
}

function requireEntry(registry, node) {
  const entry = findInbox(registry, node);
  if (!entry) {
    throw usageError(`no inbox registered for ${node}; run caller inbox init --node ${node}`);
  }
  return entry;
}

function requireToken(opts, ctx, command) {
  const token = ctx.resolveToken(opts);
  if (!token) {
    throw usageError(`${command} requires GITHUB_TOKEN, GH_TOKEN, or --token`);
  }
  return token;
}

async function requireOperatorUser(operator, token) {
  const user = await getUser(operator, token);
  if (user.type !== 'User') {
    fail(`GitHub operator must be a user account: ${operator}`);
  }
}

async function cmdInit(opts, ctx) {
  const node = opts.node;
  if (!node) throw usageError('caller inbox init requires --node owner/repo');
  const token = requireToken(opts, ctx, 'caller inbox init');
  const {
    owner: nodeOwner,
    repo: nodeRepoName,
    parsed,
  } = await ctx.loadManifestContext(node, opts.ref);
  const nodeRepo = await getRepository(nodeOwner, nodeRepoName, token);
  const declaredOperator = parsed.profiles?.github?.operator;
  if (!opts.operator && !declaredOperator && nodeRepo.owner?.type === 'Organization') {
    fail('organization-owned nodes must declare profiles.github.operator or use --operator');
  }
  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = await readInboxRegistry(registryPath);
  const existing = findInbox(registry, node);
  const operator = opts.operator || declaredOperator || existing?.operator || nodeOwner;
  await requireOperatorUser(operator, token);
  const currentUser = await getAuthenticatedUser(token);
  const inboxSlug = opts.githubRepo
    || existing?.repo
    || `github:${currentUser.login}/${defaultInboxName(node)}`;
  const { owner, repo } = parseGithubRepo(inboxSlug);

  let repository;
  let created = false;
  try {
    repository = await getRepository(owner, repo, token);
  } catch (error) {
    if (error.status !== 404) throw error;
    repository = await createPrivateRepository(owner, repo, token);
    created = true;
  }
  if (!repository.private) fail(`inbox repository must be private: ${owner}/${repo}`);

  const manifestTemplates = parseManifestDelivery(parsed)?.github?.inbox_path_template;
  const entry = {
    node,
    operator,
    repo: `github:${owner}/${repo}`,
    ref: opts.githubRef || existing?.ref || repository.default_branch || 'main',
    trust: opts.trust || existing?.trust || 'trusted',
    path_template: {
      input: opts.githubInputPath
        || existing?.path_template?.input
        || manifestTemplates?.input
        || 'tasks/{request_id}/input.enc',
      output: opts.githubOutputPath
        || existing?.path_template?.output
        || manifestTemplates?.output
        || 'tasks/{request_id}/output.enc',
    },
    grant: null,
    granted_at: null,
  };
  const update = await updateInboxRegistry(registryPath, (current) => {
    const latest = findInbox(current, node);
    const sameBinding = latest
      && latest.repo.toLowerCase() === entry.repo.toLowerCase()
      && latest.operator.toLowerCase() === operator.toLowerCase();
    return upsertInbox(current, {
      ...entry,
      grant: sameBinding ? latest.grant : null,
      granted_at: sameBinding ? latest.granted_at : null,
    });
  });
  ctx.printJson({
    ok: true,
    created,
    registry: update.path,
    inbox: findInbox(update.registry, node),
  }, opts.pretty);
}

async function cmdGrant(opts, ctx) {
  const node = opts.node;
  if (!node) throw usageError('caller inbox grant requires --node owner/repo');
  const token = requireToken(opts, ctx, 'caller inbox grant');
  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = await readInboxRegistry(registryPath, { optional: false });
  const entry = requireEntry(registry, node);
  if (entry.trust === 'blocked') fail(`inbox trust level blocks access for ${node}`, 4);
  const { owner, repo } = parseGithubRepo(entry.repo);
  await requireOperatorUser(entry.operator, token);
  const permission = opts.permission || 'push';
  if (!['push', 'maintain', 'admin'].includes(permission)) {
    throw usageError('caller inbox grant --permission must be push, maintain, or admin');
  }
  const repository = await getRepository(owner, repo, token);
  if (repository.owner?.type !== 'Organization' && permission !== 'push') {
    throw usageError('personal inbox repositories support only push collaborator permission');
  }
  const ownerHasImplicitAccess = owner.toLowerCase() === entry.operator.toLowerCase()
    && repository.owner?.type === 'User';
  const invitation = ownerHasImplicitAccess
    ? null
    : await addRepositoryCollaborator(
        owner,
        repo,
        entry.operator,
        token,
        repository.owner?.type === 'Organization' ? permission : null,
      );
  const invitationPending = Boolean(invitation?.id);
  const grant = ownerHasImplicitAccess
    ? 'owner-admin'
    : invitationPending
      ? `invitation-pending-${permission}`
      : `collaborator-${permission}`;
  const grantedAt = invitationPending ? null : new Date().toISOString();
  const update = await updateInboxRegistry(registryPath, (current) => {
    const latest = requireEntry(current, node);
    return upsertInbox(current, { ...latest, grant, granted_at: grantedAt });
  });
  ctx.printJson({
    ok: true,
    registry: update.path,
    node,
    repo: entry.repo,
    operator: entry.operator,
    permission,
    invitation_pending: invitationPending,
    owner_has_implicit_access: ownerHasImplicitAccess,
  }, opts.pretty);
}

async function cmdCheck(opts, ctx) {
  const node = opts.node;
  if (!node) throw usageError('caller inbox check requires --node owner/repo');
  const token = requireToken(opts, ctx, 'caller inbox check');
  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = await readInboxRegistry(registryPath, { optional: false });
  const entry = requireEntry(registry, node);
  const { owner, repo } = parseGithubRepo(entry.repo);
  const repository = await getRepository(owner, repo, token);
  let operatorPermission = null;
  const ownerHasImplicitAccess = owner.toLowerCase() === entry.operator.toLowerCase()
    && repository.owner?.type === 'User';
  if (ownerHasImplicitAccess) {
    operatorPermission = 'admin';
  } else {
    try {
      const result = await getRepositoryCollaboratorPermission(
        owner,
        repo,
        entry.operator,
        token,
      );
      operatorPermission = result.permission || null;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const tokenPermissions = repository.permissions || {};
  const operatorCanWrite = ['admin', 'maintain', 'write'].includes(operatorPermission);
  const ready = Boolean(repository.private && tokenPermissions.push && operatorCanWrite);
  let branchProtection = {
    available: true,
    force_push_blocked: false,
    deletion_blocked: false,
    hardened: false,
  };
  try {
    const rules = await getBranchRules(owner, repo, entry.ref, token);
    const ruleTypes = new Set(rules.map((rule) => rule.type));
    const forcePushBlocked = ruleTypes.has('non_fast_forward');
    const deletionBlocked = ruleTypes.has('deletion');
    branchProtection = {
      available: true,
      force_push_blocked: forcePushBlocked,
      deletion_blocked: deletionBlocked,
      hardened: forcePushBlocked && deletionBlocked,
    };
  } catch (error) {
    if (error.status !== 403 && error.status !== 404) throw error;
    branchProtection.available = false;
  }
  if (ready && entry.grant?.startsWith('invitation-pending-')) {
    await updateInboxRegistry(registryPath, (current) => {
      const latest = requireEntry(current, node);
      return upsertInbox(current, {
        ...latest,
        grant: ownerHasImplicitAccess ? 'owner-admin' : `collaborator-${operatorPermission}`,
        granted_at: new Date().toISOString(),
      });
    });
  }
  ctx.printJson({
    ok: Boolean(repository.private && tokenPermissions.pull),
    node,
    repo: entry.repo,
    private: Boolean(repository.private),
    current_token: {
      read: Boolean(tokenPermissions.pull),
      write: Boolean(tokenPermissions.push),
      admin: Boolean(tokenPermissions.admin),
    },
    operator: {
      login: entry.operator,
      permission: operatorPermission,
      write: operatorCanWrite,
    },
    ready,
    branch_protection: branchProtection,
  }, opts.pretty);
}

async function cmdProtect(opts, ctx) {
  const node = opts.node;
  if (!node) throw usageError('caller inbox protect requires --node owner/repo');
  const token = requireToken(opts, ctx, 'caller inbox protect');
  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = await readInboxRegistry(registryPath, { optional: false });
  const entry = requireEntry(registry, node);
  const { owner, repo } = parseGithubRepo(entry.repo);
  try {
    await ensureInboxRuleset(owner, repo, entry.ref, token);
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      fail(
        `cannot protect inbox branch ${owner}/${repo}:${entry.ref}; `
          + 'the token needs repository administration access and the GitHub plan '
          + 'must support repository rulesets for private repositories',
        4,
      );
    }
    throw error;
  }
  ctx.printJson({
    ok: true,
    node,
    repo: entry.repo,
    ref: entry.ref,
    force_push_blocked: true,
    deletion_blocked: true,
    hardened: true,
  }, opts.pretty);
}

async function cmdRevoke(opts, ctx) {
  const node = opts.node;
  if (!node) throw usageError('caller inbox revoke requires --node owner/repo');
  const token = requireToken(opts, ctx, 'caller inbox revoke');
  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = await readInboxRegistry(registryPath, { optional: false });
  const entry = requireEntry(registry, node);
  const { owner, repo } = parseGithubRepo(entry.repo);
  if (owner.toLowerCase() === entry.operator.toLowerCase()) {
    ctx.printJson({
      ok: true,
      registry: registryPath,
      node,
      repo: entry.repo,
      operator: entry.operator,
      revoked: false,
      reason: 'repository owner access cannot be revoked',
    }, opts.pretty);
    return;
  }
  await removeRepositoryCollaborator(owner, repo, entry.operator, token);
  const update = await updateInboxRegistry(registryPath, (current) => {
    const latest = requireEntry(current, node);
    return upsertInbox(current, { ...latest, grant: null, granted_at: null });
  });
  ctx.printJson({
    ok: true,
    registry: update.path,
    node,
    repo: entry.repo,
    operator: entry.operator,
    revoked: true,
  }, opts.pretty);
}

export async function cmdCaller(positional, opts, ctx) {
  if (positional[1] !== 'inbox') throw usageError('caller requires inbox');
  switch (positional[2]) {
    case 'init':
      await cmdInit(opts, ctx);
      break;
    case 'grant':
      await cmdGrant(opts, ctx);
      break;
    case 'check':
      await cmdCheck(opts, ctx);
      break;
    case 'protect':
      await cmdProtect(opts, ctx);
      break;
    case 'revoke':
      await cmdRevoke(opts, ctx);
      break;
    default:
      throw usageError('caller inbox requires init, grant, check, protect, or revoke');
  }
}

export const CALLER_HELP = `creamlon caller inbox <command> --node <owner/repo> [options]

Commands:
  init       Create or register a private per-node inbox repository
  grant      Invite the node operator, or detect owner access
  check      Show caller-token and operator repository permissions
  protect    Block force-push and deletion on the inbox branch
  revoke     Remove collaborator access (repository owners are unchanged)

Options:
  --node <owner/repo>                   Node repository
  --registry <path>                     Default: .creamlon/caller/inboxes.yaml
  --github-repo github:owner/repo       Inbox override for init
  --operator <github-user>              Override profiles.github.operator
  --trust <trusted|trial|blocked>        Default: trusted
  --permission <push|maintain|admin>    Organization inbox role; default: push
  --github-ref <branch>                 Inbox branch
  --github-input-path <template>        Must contain {request_id}
  --github-output-path <template>       Must contain {request_id}
  --token <pat>                         Caller token; or GITHUB_TOKEN / GH_TOKEN
  --pretty`;
