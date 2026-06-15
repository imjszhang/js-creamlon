import {
  addRepositoryCollaborator,
  createPrivateRepository,
  getAuthenticatedUser,
  getRepository,
  getRepositoryCollaboratorPermission,
  removeRepositoryCollaborator,
} from '../lib/github.mjs';
import {
  DEFAULT_INBOX_REGISTRY,
  findInbox,
  readInboxRegistry,
  upsertInbox,
  writeInboxRegistry,
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
  return `creamlon-inbox-${node.replace('/', '-')}`.toLowerCase().slice(0, 100);
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
  const operator = opts.operator || declaredOperator || nodeOwner;
  const currentUser = await getAuthenticatedUser(token);
  const inboxSlug = opts.githubRepo
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
  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = await readInboxRegistry(registryPath);
  const entry = {
    node,
    operator,
    repo: `github:${owner}/${repo}`,
    ref: opts.githubRef || repository.default_branch || 'main',
    trust: opts.trust || 'trusted',
    path_template: {
      input: opts.githubInputPath
        || manifestTemplates?.input
        || 'tasks/{request_id}/input.enc',
      output: opts.githubOutputPath
        || manifestTemplates?.output
        || 'tasks/{request_id}/output.enc',
    },
    grant: null,
    granted_at: null,
  };
  const path = await writeInboxRegistry(registryPath, upsertInbox(registry, entry));
  ctx.printJson({ ok: true, created, registry: path, inbox: entry }, opts.pretty);
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
  const permission = opts.permission || 'push';
  if (!['push', 'maintain', 'admin'].includes(permission)) {
    throw usageError('caller inbox grant --permission must be push, maintain, or admin');
  }
  await addRepositoryCollaborator(owner, repo, entry.operator, token, permission);
  const updated = {
    ...entry,
    grant: `collaborator-${permission}`,
    granted_at: new Date().toISOString(),
  };
  const path = await writeInboxRegistry(registryPath, upsertInbox(registry, updated));
  ctx.printJson({
    ok: true,
    registry: path,
    node,
    repo: entry.repo,
    operator: entry.operator,
    permission,
    invitation_may_require_acceptance: true,
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
  const tokenPermissions = repository.permissions || {};
  const operatorCanWrite = ['admin', 'maintain', 'write'].includes(operatorPermission);
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
    ready: Boolean(repository.private && tokenPermissions.push && operatorCanWrite),
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
  await removeRepositoryCollaborator(owner, repo, entry.operator, token);
  const updated = { ...entry, grant: null, granted_at: null };
  const path = await writeInboxRegistry(registryPath, upsertInbox(registry, updated));
  ctx.printJson({
    ok: true,
    registry: path,
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
    case 'revoke':
      await cmdRevoke(opts, ctx);
      break;
    default:
      throw usageError('caller inbox requires init, grant, check, or revoke');
  }
}

export const CALLER_HELP = `creamlon caller inbox <command> --node <owner/repo> [options]

Commands:
  init       Create or register a private per-node inbox repository
  grant      Invite the node operator with repository write access
  check      Show caller-token and operator repository permissions
  revoke     Remove the node operator's standing repository access

Options:
  --node <owner/repo>                   Node repository
  --registry <path>                     Default: .creamlon/caller/inboxes.yaml
  --github-repo github:owner/repo       Inbox override for init
  --operator <github-user>              Override profiles.github.operator
  --trust <trusted|trial|blocked>        Default: trusted
  --permission <push|maintain|admin>    Grant permission; default: push
  --github-ref <branch>                 Inbox branch
  --github-input-path <template>        Must contain {request_id}
  --github-output-path <template>       Must contain {request_id}
  --token <pat>                         Caller token; or GITHUB_TOKEN / GH_TOKEN
  --pretty`;
