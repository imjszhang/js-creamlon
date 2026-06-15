import { chmod, readFile, writeFile, mkdir, readdir, stat, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, randomUUID, randomBytes } from 'node:crypto';
import { hashText, hashFile, hashFileBytes, assertValidHashDigest } from '../lib/hash.mjs';
import { fetchManifest, parseManifest, parseRepoSlug, validateManifest } from '../lib/manifest.mjs';
import {
  buildProofFields,
  generateKeyPair,
  parseProofJson,
  publicKeyFingerprint,
  publicKeyFromBase64Url,
  publicKeyToBase64Url,
  readPrivateKeyFile,
  signProof,
  verifyProof,
} from '../lib/proof.mjs';
import {
  parseTask,
  validateTask,
  resolveInputDigest,
  serializeTask,
  taskIssueTitle,
  isTaskIssue,
} from '../lib/task.mjs';
import { loadProcessedIds } from '../lib/dedup.mjs';
import { validateTaskAcceptance } from '../lib/acceptance.mjs';
import {
  generateHmacSecret,
  loadHmacKeys,
  signHmacAuthorization,
} from '../lib/authorizationHmac.mjs';
import {
  extractBoundProofFromComments,
  verifyProofBinding,
} from '../lib/proofComment.mjs';
import {
  acquireDeliveryLock,
  readDeliveryState,
  writeDeliveryState,
} from '../lib/deliveryState.mjs';
import { findProofByRequestId, parseProofsLog, sameProof } from '../lib/proofsLog.mjs';
import {
  createIssue,
  listIssues,
  getIssue,
  createIssueComment,
  closeIssue,
  getIssueComments,
  getGithubToken,
  getRepositoryFile,
  searchRepositories,
} from '../lib/github.mjs';
import { discoverRepositories } from '../lib/discovery.mjs';
import { readDiscoveryCache, writeDiscoveryCache } from '../lib/discoveryCache.mjs';
import {
  inspectKeyContinuity,
  publicKeyAt,
  signKeyRotation,
} from '../lib/identity.mjs';
import {
  appendRedemption,
  authorizeCredential,
  findCredential,
  generateCredential,
  loadCredentialStore,
  loadRedemptions,
  publicCredentialRecord,
  updateCredentialStore,
  validateRedemption,
} from '../lib/credential.mjs';
import { cmdExtension, EXTENSION_DELIVERY_HELP } from './extensionDelivery.mjs';
import { cmdCaller, CALLER_HELP } from './callerInbox.mjs';
import { parseManifestDelivery } from '../lib/extensions/delivery/schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'template', 'agent-node');
const PACKAGE_VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const VALUE_OPTIONS = new Set([
  '--out', '--file', '--request-id', '--capability-id', '--input-digest', '--output-digest',
  '--input', '--input-url', '--media-type', '--requester', '--expires',
  '--authorization-key-id', '--key-id', '--authorization-expires',
  '--keys', '--reason', '--repo-path', '--output-file', '--key',
  '--completed-at', '--repo', '--public-key', '--proof', '--name', '--ref', '--token',
  '--input-type', '--output-type', '--status', '--limit', '--sort', '--cache-ttl',
  '--old-public-key', '--new-public-key', '--rotated-at', '--status-out',
  '--credential', '--credentials', '--credential-digest', '--task-intent-digest',
  '--extensions-file', '--extensions-json', '--transport', '--outbox-dir', '--extensions-out',
  '--input-upload-url', '--input-get-url', '--output-upload-url', '--output-get-url',
  '--github-repo', '--github-input-path', '--github-output-path', '--github-ref',
  '--task-file', '--manifest-file', '--receive-public-key', '--input-file', '--outbox', '--delivery-key',
  '--proof-file', '--no-verify',
  '--node', '--registry', '--operator', '--trust', '--permission',
]);

const HELP = {
  main: `Creamlon - Creamlon protocol CLI v${PACKAGE_VERSION}

Usage:
  creamlon <command> [options]

Commands:
  keygen [--out <dir>]              Generate Ed25519 key pair
  key-rotate [options]              Record a signed public-key rotation
  hmac-key-new [options]            Generate HMAC authorization key
  credential create [options]       Create a one-time task credential
  credential list [options]         List credential status without secrets
  credential revoke <id> [options]  Revoke an unused credential
  hash <text>                       Hash text as sha256:...
  hash --file <path>                Hash file contents
  sign [options]                    Sign and output proof JSON
  verify [options]                  Verify proof signature
  inspect <owner/repo>              Fetch and show creamlon.yaml
  discover <capability-id>          Find nodes via GitHub Topic search
  submit <owner/repo> [options]     Create task Issue (needs GITHUB_TOKEN)
  watch <owner/repo> [options]      List pending tasks (needs GITHUB_TOKEN)
  deliver <owner/repo> <issue#>     Sign and deliver proof (needs GITHUB_TOKEN)
  reject <owner/repo> <issue#>      Reject task Issue (needs GITHUB_TOKEN)
  fetch-proof <owner/repo> <issue#> Extract proof from Issue comments
  audit [--repo-path <dir>]          Audit local proofs.log
  status [--repo-path <dir>]         Write public node health status
  init <dir> [--name <name>]        Scaffold agent node from template
  caller inbox <cmd>                Manage private per-node caller inboxes
  extension delivery <cmd>          Private artifact delivery helpers
  help [command]                    Show help

submit/deliver/reject and caller inbox management require GITHUB_TOKEN, GH_TOKEN, or --token.
Public discover/watch/fetch-proof reads can run anonymously with lower rate limits.
Run "creamlon help <command>" for details.`,
  keygen: `creamlon keygen [--out <dir>]

Generate Ed25519 key pair. Writes public.key, private.key, public.b64url to --out (default: .creamlon).`,
  keyRotate: `creamlon key-rotate [options]

Options:
  --old-public-key <b64>  Previous public key
  --new-public-key <b64>  New public key now published in creamlon.yaml
  --key <path>            Previous private key (default: .creamlon/private.key)
  --rotated-at <iso>      Optional rotation timestamp
  --repo-path <dir>       Node repository (default: .)

Appends a signed record to trust/key-rotations.log.`,
  hmacKeyNew: `creamlon hmac-key-new --key-id <id> [--out <path>]

Generate an HMAC authorization key map (default: .creamlon/authorization.keys.json).`,
  credential: `creamlon credential <create|list|revoke> [options]

Commands:
  create --capability-id <id> [--expires <iso>]
  list
  revoke <credential-id>

Options:
  --repo-path <dir>      Node repository (default: .)
  --credentials <path>   Private store (default: <repo>/.creamlon/credentials.json)
  --pretty               Pretty-print JSON

The complete credential is displayed only by create. Keep it secret.`,
  caller: CALLER_HELP,
  hash: `creamlon hash <text>
creamlon hash --file <path>

Compute a sha256:... digest.
--file hashes raw file bytes (use with --input-digest and extension delivery).
Multi-word text is joined with spaces; quote text that contains shell metacharacters.`,
  sign: `creamlon sign [options]

Options:
  --request-id <uuid>
  --capability-id <id>
  --input-digest <sha256:...>
  --output-digest <sha256:...>
  --credential-digest <sha256:...>   Optional; requires --task-intent-digest
  --task-intent-digest <sha256:...>  Optional; requires --credential-digest
  --key <path>          Private key file (default: .creamlon/private.key)
  --completed-at <iso>  Optional ISO timestamp
  --pretty              Pretty-print JSON`,
  verify: `creamlon verify [options]

Options:
  --repo <owner/repo>   Fetch identity from creamlon.yaml
  --ref <branch>        Git branch (default: main)
  --token <pat>         Load key rotations for historical proofs
  --public-key <b64>    Or supply public key directly
  --proof <path>        Proof JSON file (or stdin if omitted)
  --pretty              Pretty-print JSON result`,
  inspect: `creamlon inspect <owner/repo> [--ref main]

Fetch creamlon.yaml from GitHub and display capabilities.`,
  discover: `creamlon discover <capability-id> [options]

Find nodes through the required GitHub Topic "creamlon-node".

Options:
  --input-type <type>    Filter capability input type
  --output-type <type>   Filter capability output type
  --status <status>      available, busy, or offline
  --sort <mode>          default or updated
  --limit <count>        Result limit (default: 20, max: 100)
  --refresh              Ignore the local 10-minute cache
  --cache-ttl <seconds>  Override cache lifetime
  --token <pat>          GitHub token (or GITHUB_TOKEN / GH_TOKEN)
  --pretty`,
  submit: `creamlon submit <owner/repo> [options]

Options:
  --capability-id <id>   Required
  --requester <github:user/repo>  Required
  --input <text>         Inline task input
  --input-digest <sha256:...>
  --input-url <url>
  --media-type <type>    Required input media type
  --request-id <uuid>    Default: random UUID
  --expires <iso>        Optional expiry
  --authorization-key-id <id>  Required only when the node declares authorization
  --keys <path>                 Private HMAC key map
  --authorization-expires <iso>
  --credential <crv1_...>  One-time task credential
  --extensions-file <json>   Task extensions JSON object
  --extensions-json <json>   Inline task extensions JSON
  --ref <branch>         creamlon.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN / GH_TOKEN)
  --pretty               Pretty-print result JSON`,
  watch: `creamlon watch <owner/repo> [options]

Options:
  --repo-path <dir>      Local node dir for proofs.log and HMAC keys
  --keys <path>          HMAC key map
  --credentials <path>   Private credential store
  --ref <branch>         creamlon.yaml branch (default: main)
  --once                 Poll once and exit (default)
  --token <pat>          GitHub token (or GITHUB_TOKEN / GH_TOKEN)
  --pretty               Pretty-print JSON`,
  deliver: `creamlon deliver <owner/repo> <issue-number> [options]

Options:
  --output-file <path>   Hash deliverable file for output_digest (required)
  --repo-path <dir>      Local node dir (default: .)
  --keys <path>          HMAC key map
  --credentials <path>   Private credential store
  --key <path>           Private key (default: <repo-path>/.creamlon/private.key)
  --ref <branch>         creamlon.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN / GH_TOKEN)
  --dry-run              Print proof only; no GitHub or file writes
  --resume               Resume a partially completed delivery
  --pretty               Pretty-print JSON`,
  reject: `creamlon reject <owner/repo> <issue-number> [options]

Options:
  --reason <text>        Rejection reason (default: validation errors joined)
  --repo-path <dir>      Local node dir for proofs.log and HMAC keys
  --keys <path>          HMAC key map
  --credentials <path>   Private credential store
  --ref <branch>         creamlon.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN / GH_TOKEN)
  --pretty               Pretty-print JSON`,
  fetchProof: `creamlon fetch-proof <owner/repo> <issue-number> [options]

Options:
  --verify               Verify proof signature against the manifest identity
  --ref <branch>         creamlon.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN / GH_TOKEN)
  --pretty               Pretty-print JSON`,
  audit: `creamlon audit [--repo-path <dir>] [--pretty]

Validate local creamlon.yaml and every proof in trust/proofs.log.`,
  status: `creamlon status [--repo-path <dir>] [--status-out <path>] [--pretty]

Audit the node and write trust/status.json for discovery. The output path defaults to <repo-path>/trust/status.json.`,
  init: `creamlon init <dir> [--name <name>]

Copy template/agent-node/ to <dir> and replace {{name}} placeholders.`,
  extensionDelivery: EXTENSION_DELIVERY_HELP,
};

function parseArgs(argv) {
  const positional = [];
  const opts = { pretty: false, once: true, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg) && (argv[i + 1] == null || argv[i + 1].startsWith('--'))) {
      throw usageError(`${arg} requires a value`);
    }
    if (arg === '--pretty') opts.pretty = true;
    else if (arg === '--once') opts.once = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--refresh') opts.refresh = true;
    else if (arg === '--out') { i += 1; opts.out = argv[i]; }
    else if (arg === '--file') { i += 1; opts.file = argv[i]; }
    else if (arg === '--request-id') { i += 1; opts.requestId = argv[i]; }
    else if (arg === '--capability-id') { i += 1; opts.capabilityId = argv[i]; }
    else if (arg === '--input-digest') { i += 1; opts.inputDigest = argv[i]; }
    else if (arg === '--output-digest') { i += 1; opts.outputDigest = argv[i]; }
    else if (arg === '--input') { i += 1; opts.input = argv[i]; }
    else if (arg === '--input-url') { i += 1; opts.inputUrl = argv[i]; }
    else if (arg === '--media-type') { i += 1; opts.mediaType = argv[i]; }
    else if (arg === '--requester') { i += 1; opts.requester = argv[i]; }
    else if (arg === '--expires') { i += 1; opts.expires = argv[i]; }
    else if (arg === '--authorization-key-id' || arg === '--key-id') {
      i += 1; opts.authorizationKeyId = argv[i];
    }
    else if (arg === '--authorization-expires') { i += 1; opts.authorizationExpires = argv[i]; }
    else if (arg === '--keys') { i += 1; opts.keys = argv[i]; }
    else if (arg === '--reason') { i += 1; opts.reason = argv[i]; }
    else if (arg === '--verify') opts.verify = true;
    else if (arg === '--repo-path') { i += 1; opts.repoPath = argv[i]; }
    else if (arg === '--output-file') { i += 1; opts.outputFile = argv[i]; }
    else if (arg === '--key') { i += 1; opts.key = argv[i]; }
    else if (arg === '--completed-at') { i += 1; opts.completedAt = argv[i]; }
    else if (arg === '--repo') { i += 1; opts.repo = argv[i]; }
    else if (arg === '--public-key') { i += 1; opts.publicKey = argv[i]; }
    else if (arg === '--proof') { i += 1; opts.proof = argv[i]; }
    else if (arg === '--name') { i += 1; opts.name = argv[i]; }
    else if (arg === '--ref') { i += 1; opts.ref = argv[i]; }
    else if (arg === '--token') { i += 1; opts.token = argv[i]; }
    else if (arg === '--input-type') { i += 1; opts.inputType = argv[i]; }
    else if (arg === '--output-type') { i += 1; opts.outputType = argv[i]; }
    else if (arg === '--status') { i += 1; opts.status = argv[i]; }
    else if (arg === '--limit') { i += 1; opts.limit = argv[i]; }
    else if (arg === '--sort') { i += 1; opts.sort = argv[i]; }
    else if (arg === '--cache-ttl') { i += 1; opts.cacheTtl = argv[i]; }
    else if (arg === '--old-public-key') { i += 1; opts.oldPublicKey = argv[i]; }
    else if (arg === '--new-public-key') { i += 1; opts.newPublicKey = argv[i]; }
    else if (arg === '--rotated-at') { i += 1; opts.rotatedAt = argv[i]; }
    else if (arg === '--status-out') { i += 1; opts.statusOut = argv[i]; }
    else if (arg === '--credential') { i += 1; opts.credential = argv[i]; }
    else if (arg === '--credentials') { i += 1; opts.credentials = argv[i]; }
    else if (arg === '--credential-digest') { i += 1; opts.credentialDigest = argv[i]; }
    else if (arg === '--task-intent-digest') { i += 1; opts.taskIntentDigest = argv[i]; }
    else if (arg === '--extensions-file') { i += 1; opts.extensionsFile = argv[i]; }
    else if (arg === '--extensions-json') { i += 1; opts.extensionsJson = argv[i]; }
    else if (arg === '--transport') { i += 1; opts.transport = argv[i]; }
    else if (arg === '--outbox-dir') { i += 1; opts.outboxDir = argv[i]; }
    else if (arg === '--extensions-out') { i += 1; opts.extensionsOut = argv[i]; }
    else if (arg === '--input-upload-url') { i += 1; opts.inputUploadUrl = argv[i]; }
    else if (arg === '--input-get-url') { i += 1; opts.inputGetUrl = argv[i]; }
    else if (arg === '--output-upload-url') { i += 1; opts.outputUploadUrl = argv[i]; }
    else if (arg === '--output-get-url') { i += 1; opts.outputGetUrl = argv[i]; }
    else if (arg === '--github-repo') { i += 1; opts.githubRepo = argv[i]; }
    else if (arg === '--github-input-path') { i += 1; opts.githubInputPath = argv[i]; }
    else if (arg === '--github-output-path') { i += 1; opts.githubOutputPath = argv[i]; }
    else if (arg === '--github-ref') { i += 1; opts.githubRef = argv[i]; }
    else if (arg === '--task-file') { i += 1; opts.taskFile = argv[i]; }
    else if (arg === '--manifest-file') { i += 1; opts.manifestFile = argv[i]; }
    else if (arg === '--receive-public-key') { i += 1; opts.receivePublicKey = argv[i]; }
    else if (arg === '--input-file') { i += 1; opts.inputFile = argv[i]; }
    else if (arg === '--outbox') { i += 1; opts.outbox = argv[i]; }
    else if (arg === '--delivery-key') { i += 1; opts.deliveryKey = argv[i]; }
    else if (arg === '--proof-file') { i += 1; opts.proofFile = argv[i]; }
    else if (arg === '--no-verify') opts.noVerify = true;
    else if (arg === '--node') { i += 1; opts.node = argv[i]; }
    else if (arg === '--registry') { i += 1; opts.registry = argv[i]; }
    else if (arg === '--operator') { i += 1; opts.operator = argv[i]; }
    else if (arg === '--trust') { i += 1; opts.trust = argv[i]; }
    else if (arg === '--permission') { i += 1; opts.permission = argv[i]; }
    else if (arg.startsWith('--')) throw usageError(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { positional, opts };
}

function usageError(msg) {
  const err = new Error(msg);
  err.exitCode = 1;
  return err;
}

function fail(msg, code = 2) {
  const err = new Error(msg);
  err.exitCode = code;
  throw err;
}

function printJson(obj, pretty) {
  console.log(JSON.stringify(obj, null, pretty ? 2 : 0));
}

function resolveToken(opts) {
  return getGithubToken(opts.token);
}

async function loadManifestContext(slug, ref) {
  const { owner, repo } = parseRepoSlug(slug);
  const { parsed } = await fetchManifest(owner, repo, ref || 'main');
  const manifestErrors = validateManifest(parsed, { requireGithubProfile: true });
  if (manifestErrors.length) {
    fail(`invalid creamlon.yaml: ${manifestErrors.join('; ')}`);
  }
  return { owner, repo, parsed };
}

async function loadAuthorizationSecrets(opts) {
  const repoPath = resolve(opts.repoPath || '.');
  const hmacKeys = await loadHmacKeys(opts.keys || join(repoPath, '.creamlon', 'authorization.keys.json'));
  return { hmacKeys };
}

function credentialPaths(opts) {
  const repoPath = resolve(opts.repoPath || '.');
  return {
    repoPath,
    storePath: resolve(opts.credentials || join(repoPath, '.creamlon', 'credentials.json')),
    redemptionsPath: join(repoPath, 'trust', 'redemptions.log'),
  };
}

async function loadCredentialContext(opts) {
  const paths = credentialPaths(opts);
  const [credentialStore, redemptions] = await Promise.all([
    loadCredentialStore(paths.storePath),
    loadRedemptions(paths.redemptionsPath),
  ]);
  return { ...paths, credentialStore, redemptions };
}

async function cmdKeygen(opts) {
  const outDir = opts.out || '.creamlon';
  const result = await generateKeyPair(outDir);
  console.log(`Keys written to ${outDir}/`);
  console.log(`public_key (base64url): ${result.publicKeyBase64Url}`);
  console.log('Keep private.key secret; add public_key to creamlon.yaml');
}

async function cmdHash(positional, opts) {
  if (opts.file) {
    const digest = await hashFileBytes(opts.file);
    console.log(digest);
    return;
  }
  const text = positional.slice(1).join(' ');
  if (!text) throw usageError('hash requires <text> or --file');
  console.log(hashText(text));
}

async function cmdSign(opts) {
  const keyPath = opts.key || '.creamlon/private.key';
  const required = ['requestId', 'capabilityId', 'inputDigest', 'outputDigest'];
  for (const k of required) {
    if (!opts[k]) throw usageError(`sign requires --${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  }
  assertValidHashDigest(opts.inputDigest, 'input_digest');
  assertValidHashDigest(opts.outputDigest, 'output_digest');
  if (!!opts.credentialDigest !== !!opts.taskIntentDigest) {
    throw usageError('sign credential digest options must be provided together');
  }
  if (opts.credentialDigest) {
    assertValidHashDigest(opts.credentialDigest, 'credential_digest');
    assertValidHashDigest(opts.taskIntentDigest, 'task_intent_digest');
  }
  const privateKey = await readPrivateKeyFile(keyPath);
  const fields = buildProofFields({
    requestId: opts.requestId,
    capabilityId: opts.capabilityId,
    inputDigest: opts.inputDigest,
    outputDigest: opts.outputDigest,
    credentialDigest: opts.credentialDigest,
    taskIntentDigest: opts.taskIntentDigest,
    completedAt: opts.completedAt,
  });
  const proof = signProof(fields, privateKey);
  printJson(proof, opts.pretty);
}

async function cmdVerify(opts) {
  let proofText;
  if (opts.proof) {
    proofText = await readFile(opts.proof, 'utf8');
  } else {
    proofText = await readStdin();
  }
  const proof = parseProofJson(proofText);

  let publicKeyB64 = opts.publicKey;
  let continuity = null;
  if (opts.repo) {
    const { owner, repo } = parseRepoSlug(opts.repo);
    const { parsed } = await fetchManifest(owner, repo, opts.ref || 'main');
    const manifestErrors = validateManifest(parsed, { requireGithubProfile: true });
    if (manifestErrors.length) fail(`invalid creamlon.yaml: ${manifestErrors.join('; ')}`);
    publicKeyB64 = parsed.identity?.public_key;
    if (!publicKeyB64) fail('creamlon.yaml has no identity.public_key');
    const token = resolveToken(opts);
    const rotationsText = await getRepositoryFile(
      owner,
      repo,
      'trust/key-rotations.log',
      opts.ref || 'main',
      token,
      { optional: true },
    );
    continuity = inspectKeyContinuity(rotationsText, publicKeyB64);
    if (continuity.status === 'broken') {
      fail(`invalid key rotation chain: ${continuity.errors.join('; ')}`);
    }
    publicKeyB64 = publicKeyAt(continuity.history, proof.completed_at);
    if (!publicKeyB64) fail('no public key valid at proof completion time');
  }
  if (!publicKeyB64) throw usageError('verify requires --repo or --public-key');

  const publicKey = publicKeyFromBase64Url(publicKeyB64);
  const result = verifyProof(proof, publicKey);
  if (opts.pretty || !result.ok) {
    printJson({
      ...result,
      request_id: proof.request_id,
      ...(continuity ? { key_continuity: continuity.status } : {}),
    }, opts.pretty);
  } else {
    console.log('ok: true');
  }
  if (!result.ok) fail(result.reason || 'verification failed');
}

async function cmdInspect(positional, opts) {
  const slug = positional[1];
  if (!slug) throw usageError('inspect requires <owner/repo>');
  const { owner, repo } = parseRepoSlug(slug);
  const { parsed, url } = await fetchManifest(owner, repo, opts.ref || 'main');
  const errors = validateManifest(parsed, { requireGithubProfile: true });
  const out = {
    repo: `${owner}/${repo}`,
    url,
    name: parsed.name,
    description: parsed.description,
    manifest: parsed,
    public_key_fingerprint: null,
    valid: errors.length === 0,
    errors,
  };
  if (out.valid) out.public_key_fingerprint = publicKeyFingerprint(parsed.identity.public_key);
  const delivery = parseManifestDelivery(parsed);
  if (delivery) out.delivery_extension = delivery;
  printJson(out, opts.pretty);
}

async function cmdDiscover(positional, opts) {
  const capabilityId = positional[1];
  if (!capabilityId) throw usageError('discover requires <capability-id>');
  const limit = opts.limit == null ? 20 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw usageError('discover --limit must be an integer from 1 to 100');
  }
  const sort = opts.sort || 'default';
  if (!['default', 'updated'].includes(sort)) {
    throw usageError('discover --sort must be default or updated');
  }
  if (opts.status && !['available', 'busy', 'offline'].includes(opts.status)) {
    throw usageError('discover --status must be available, busy, or offline');
  }
  const ttlSeconds = opts.cacheTtl == null ? 600 : Number(opts.cacheTtl);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    throw usageError('discover --cache-ttl must be a non-negative number');
  }

  const token = resolveToken(opts);
  const cachePath = resolve('.creamlon', 'cache', 'discovery.json');
  const cacheKey = JSON.stringify({
    schema: 3,
    capabilityId,
    inputType: opts.inputType || null,
    outputType: opts.outputType || null,
    status: opts.status || null,
    sort,
    limit,
  });
  if (!opts.refresh) {
    const cached = await readDiscoveryCache(cachePath, cacheKey, ttlSeconds * 1000);
    if (cached) {
      printJson({ ...cached, cached: true }, opts.pretty);
      return;
    }
  }

  const repositories = await searchRepositories({ limit: 100, token });
  const result = await discoverRepositories(repositories, {
    capabilityId,
    inputType: opts.inputType,
    outputType: opts.outputType,
    status: opts.status,
    sort,
    limit,
    fetchFile: (repository, path, ref, optional) => {
      const [owner, repo] = repository.full_name.split('/');
      return getRepositoryFile(owner, repo, path, ref, token, { optional });
    },
  });
  await writeDiscoveryCache(cachePath, cacheKey, result);
  printJson({ ...result, cached: false }, opts.pretty);
}

async function cmdSubmit(positional, opts) {
  const slug = positional[1];
  if (!slug) throw usageError('submit requires <owner/repo>');
  if (!opts.capabilityId) throw usageError('submit requires --capability-id');
  if (!opts.requester) throw usageError('submit requires --requester');

  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
  const capIds = parsed.capabilities.map((capability) => capability.id);
  const task = {
    version: '1',
    request_id: opts.requestId || randomUUID(),
    capability_id: opts.capabilityId,
    requester: opts.requester,
    expires: opts.expires || null,
    authorization: null,
    credential: null,
    input: {
      media_type: opts.mediaType || null,
      value: null,
      url: null,
      digest: null,
    },
  };

  if (!opts.mediaType) throw usageError('submit requires --media-type');
  const inputModes = [opts.input, opts.inputDigest, opts.inputUrl].filter((value) => value != null);
  if (inputModes.length === 0) throw usageError('submit requires --input, --input-digest, or --input-url');
  if (inputModes.length > 1) throw usageError('submit: only one input mode allowed');

  if (opts.input != null) task.input.value = opts.input;
  if (opts.inputDigest) task.input.digest = opts.inputDigest;
  if (opts.inputUrl) task.input.url = opts.inputUrl;

  const authorizationRequired = !!parsed.profiles?.authorization;
  if (authorizationRequired) {
    if (!opts.authorizationKeyId) throw usageError('submit requires --authorization-key-id');
    if (!opts.authorizationExpires) throw usageError('submit requires --authorization-expires');
    if (!opts.keys) throw usageError('submit requires --keys');
    const keys = await loadHmacKeys(opts.keys);
    const secret = keys.get(opts.authorizationKeyId);
    if (!secret) throw usageError(`no authorization secret configured for key_id: ${opts.authorizationKeyId}`);
    task.authorization = signHmacAuthorization(task, {
      keyId: opts.authorizationKeyId,
      secret,
      expires: opts.authorizationExpires,
    });
  }

  const capability = parsed.capabilities.find((item) => item.id === task.capability_id);
  const credentialRequired = capability?.access?.mode === 'credential';
  if (credentialRequired && !opts.credential) {
    throw usageError('submit requires --credential for this capability');
  }
  if (opts.credential) {
    if (!task.expires) {
      task.expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    task.credential = authorizeCredential(task, parsed, opts.credential);
  }

  if (opts.extensionsFile) {
    const raw = JSON.parse(await readFile(resolve(opts.extensionsFile), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('extensions file must be a JSON object');
    }
    task.extensions = raw;
  } else if (opts.extensionsJson) {
    const raw = JSON.parse(opts.extensionsJson);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('extensions JSON must be an object');
    }
    task.extensions = raw;
  }

  const errors = validateTask(task, {
    capability_ids: capIds,
    authorization_required: authorizationRequired,
    credential_required: credentialRequired,
  });
  if (errors.length) fail(`invalid task: ${errors.join('; ')}`);

  const body = serializeTask(task);
  const title = taskIssueTitle(task.capability_id);
  const issue = await createIssue(owner, repo, title, body, token);

  const out = {
    ok: true,
    request_id: task.request_id,
    issue_number: issue.number,
    issue_url: issue.html_url,
    title: issue.title,
  };
  printJson(out, opts.pretty);
}

async function cmdWatch(positional, opts) {
  const slug = positional[1];
  if (!slug) throw usageError('watch requires <owner/repo>');

  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
  const authorizationSecrets = await loadAuthorizationSecrets(opts);
  const { credentialStore, redemptions } = await loadCredentialContext(opts);

  let processed = new Set();
  if (opts.repoPath) {
    const proofsPath = join(resolve(opts.repoPath), 'trust', 'proofs.log');
    processed = await loadProcessedIds(proofsPath);
  }

  const issues = await listIssues(owner, repo, { state: 'open', token });
  const taskIssues = issues.filter((i) => isTaskIssue(i.title) && !i.pull_request);

  const results = [];
  for (const issue of taskIssues) {
    try {
      const task = parseTask(issue.body || '');
      const acceptance = validateTaskAcceptance(task, issue, {
        manifest: parsed,
        processedIds: processed,
        authorizationSecrets,
        credentialStore,
        redemptions,
        checkIssueMeta: true,
      });

      results.push({
        issue_number: issue.number,
        issue_url: issue.html_url,
        title: issue.title,
        request_id: task.request_id,
        capability_id: task.capability_id,
        requester: task.requester,
        valid: acceptance.errors.length === 0,
        errors: acceptance.errors,
        authorization_ok: acceptance.authorization_ok,
        authorization_error: acceptance.authorization_error,
        credential_ok: acceptance.credential_ok,
        credential_error: acceptance.credential_error,
      });
    } catch (error) {
      results.push({
        issue_number: issue.number,
        issue_url: issue.html_url,
        title: issue.title,
        request_id: null,
        capability_id: null,
        requester: null,
        valid: false,
        errors: [error.message],
        authorization_ok: false,
        authorization_error: null,
        credential_ok: false,
        credential_error: null,
      });
    }
  }

  printJson({
    repo: `${owner}/${repo}`,
    pending_count: results.length,
    valid_count: results.filter((task) => task.valid).length,
    invalid_count: results.filter((task) => !task.valid).length,
    tasks: results,
  }, opts.pretty);
}

async function cmdDeliver(positional, opts) {
  const slug = positional[1];
  const issueNumber = positional[2];
  if (!slug) throw usageError('deliver requires <owner/repo> <issue-number>');
  if (!issueNumber) throw usageError('deliver requires <issue-number>');
  if (!/^[1-9]\d*$/.test(issueNumber)) throw usageError('deliver issue number must be a positive integer');
  if (!opts.outputFile) throw usageError('deliver requires --output-file');

  const token = resolveToken(opts);
  const repoPath = resolve(opts.repoPath || '.');
  const keyPath = opts.key || join(repoPath, '.creamlon', 'private.key');
  const proofsPath = join(repoPath, 'trust', 'proofs.log');
  const redemptionsPath = join(repoPath, 'trust', 'redemptions.log');
  const statePath = join(repoPath, '.creamlon', 'deliveries', `${issueNumber}.json`);
  const lockPath = join(repoPath, '.creamlon', 'deliver.lock');
  const releaseLock = opts.dryRun ? null : await acquireDeliveryLock(lockPath);

  try {
    const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
    const authorizationSecrets = await loadAuthorizationSecrets(opts);
    const { credentialStore, redemptions } = await loadCredentialContext({ ...opts, repoPath });
    const issue = await getIssue(owner, repo, issueNumber, token);
    const task = parseTask(issue.body || '');
    const existingState = await readDeliveryState(statePath);
    if (opts.resume && !existingState) fail('no delivery state to resume', 4);

    const processed = await loadProcessedIds(proofsPath);
    const acceptance = validateTaskAcceptance(task, issue, {
      manifest: parsed,
      processedIds: existingState ? null : processed,
      authorizationSecrets,
      credentialStore,
      redemptions,
      checkIssueMeta: !existingState,
    });
    if (acceptance.errors.length) fail(`cannot deliver: ${acceptance.errors.join('; ')}`);

    const inputDigest = resolveInputDigest(task);
    const outputDigest = await hashFile(opts.outputFile);
    let proof = existingState?.proof || null;
    if (proof) {
      const binding = verifyProofBinding(proof, task, inputDigest, { manifest: parsed });
      if (!binding.ok || proof.output_digest !== outputDigest) {
        fail('stored delivery state conflicts with task or output', 4);
      }
    } else {
      const privateKey = await readPrivateKeyFile(keyPath);
      proof = signProof(buildProofFields({
        requestId: task.request_id,
        capabilityId: task.capability_id,
        inputDigest,
        outputDigest,
        credentialDigest: acceptance.credential_digest,
        taskIntentDigest: acceptance.task_intent_digest,
        completedAt: opts.completedAt,
      }), privateKey);
    }

    if (opts.dryRun) {
      printJson({ ok: true, dry_run: true, proof }, opts.pretty);
      return;
    }

    if (!existingState && task.credential) {
      const existingRedemption = redemptions.find(
        (item) => item.credential_id === task.credential.credential_id,
      );
      if (!existingRedemption) {
        await appendRedemption(redemptionsPath, {
          version: '1',
          request_id: task.request_id,
          credential_id: task.credential.credential_id,
          credential_digest: acceptance.credential_digest,
          task_intent_digest: acceptance.task_intent_digest,
          capability_id: task.capability_id,
          redeemed_at: new Date().toISOString(),
        });
      }
    }

    const state = existingState || {
      issue_number: Number(issueNumber),
      request_id: task.request_id,
      status: 'prepared',
      proof,
      updated_at: new Date().toISOString(),
    };
    await writeDeliveryState(statePath, state);

    if (state.status === 'prepared') {
      const comments = await getIssueComments(owner, repo, issueNumber, token);
      const remote = extractBoundProofFromComments(comments, task, inputDigest, { manifest: parsed });
      if (remote.proof && !sameProof(remote.proof, proof)) {
        fail('issue already contains a conflicting valid proof', 4);
      }
      if (!remote.proof) {
        const commentBody = `Creamlon delivery proof:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\``;
        await createIssueComment(owner, repo, issueNumber, commentBody, token);
      }
      state.status = 'commented';
      state.updated_at = new Date().toISOString();
      await writeDeliveryState(statePath, state);
    }

    if (state.status === 'commented') {
      let logText = '';
      try {
        logText = await readFile(proofsPath, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const existingProof = findProofByRequestId(parseProofsLog(logText), task.request_id);
      if (existingProof && !sameProof(existingProof, proof)) {
        fail('proofs.log contains a conflicting proof', 4);
      }
      if (!existingProof) {
        await mkdir(dirname(proofsPath), { recursive: true });
        await appendFile(proofsPath, `${JSON.stringify(proof)}\n`, 'utf8');
      }
      state.status = 'logged';
      state.updated_at = new Date().toISOString();
      await writeDeliveryState(statePath, state);
    }

    if (state.status === 'logged') {
      if (issue.state !== 'closed') await closeIssue(owner, repo, issueNumber, token);
      state.status = 'closed';
      state.updated_at = new Date().toISOString();
      await writeDeliveryState(statePath, state);
    }

    printJson({
      ok: true,
      idempotent: !!existingState,
      status: state.status,
      request_id: task.request_id,
      issue_number: Number(issueNumber),
      proofs_log: proofsPath,
      ...(task.credential ? { redemptions_log: redemptionsPath } : {}),
      proof,
      next_steps: [
        `git -C ${repoPath} add trust/proofs.log${task.credential ? ' trust/redemptions.log' : ''}`,
        `git -C ${repoPath} commit -m "creamlon: deliver ${task.request_id}"`,
        `git -C ${repoPath} push`,
      ],
    }, opts.pretty);
  } finally {
    if (releaseLock) await releaseLock();
  }
}

async function cmdReject(positional, opts) {
  const slug = positional[1];
  const issueNumber = positional[2];
  if (!slug) throw usageError('reject requires <owner/repo> <issue-number>');
  if (!issueNumber) throw usageError('reject requires <issue-number>');
  if (!/^[1-9]\d*$/.test(issueNumber)) throw usageError('reject issue number must be a positive integer');

  const token = resolveToken(opts);
  const repoPath = resolve(opts.repoPath || '.');
  const proofsPath = join(repoPath, 'trust', 'proofs.log');

  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
  const authorizationSecrets = await loadAuthorizationSecrets(opts);
  const { credentialStore, redemptions } = await loadCredentialContext({ ...opts, repoPath });

  const issue = await getIssue(owner, repo, issueNumber, token);
  const task = parseTask(issue.body || '');

  const processed = await loadProcessedIds(proofsPath);
  const acceptance = validateTaskAcceptance(task, issue, {
    manifest: parsed,
    processedIds: processed,
    authorizationSecrets,
    credentialStore,
    redemptions,
    checkIssueMeta: true,
  });

  const reason = opts.reason || acceptance.errors.join('; ') || 'task rejected';
  const commentBody = `Creamlon rejection:\n\n${reason}`;
  await createIssueComment(owner, repo, issueNumber, commentBody, token);
  await closeIssue(owner, repo, issueNumber, token);

  printJson({
    ok: true,
    issue_number: Number(issueNumber),
    reason,
    validation_errors: acceptance.errors,
  }, opts.pretty);
}

async function cmdFetchProof(positional, opts) {
  const slug = positional[1];
  const issueNumber = positional[2];
  if (!slug) throw usageError('fetch-proof requires <owner/repo> <issue-number>');
  if (!issueNumber) throw usageError('fetch-proof requires <issue-number>');
  if (!/^[1-9]\d*$/.test(issueNumber)) throw usageError('fetch-proof issue number must be a positive integer');

  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);

  const [issue, comments] = await Promise.all([
    getIssue(owner, repo, issueNumber, token),
    getIssueComments(owner, repo, issueNumber, token),
  ]);
  const task = parseTask(issue.body || '');
  const taskErrors = validateTask(task, {
    capability_ids: parsed.capabilities.map((capability) => capability.id),
    authorization_required: !!parsed.profiles?.authorization,
    credential_required: parsed.capabilities
      .find((item) => item.id === task.capability_id)?.access?.mode === 'credential',
  });
  if (taskErrors.length) fail(`invalid issue task: ${taskErrors.join('; ')}`);
  if (issue.title !== taskIssueTitle(task.capability_id)) {
    fail('issue title capability does not match task capability_id');
  }
  const inputDigest = resolveInputDigest(task);
  const extracted = extractBoundProofFromComments(comments, task, inputDigest, { manifest: parsed });
  const proof = extracted.proof;

  const out = {
    ok: !!proof,
    issue_number: Number(issueNumber),
    proof,
    binding: proof
      ? verifyProofBinding(proof, task, inputDigest, { manifest: parsed })
      : { ok: false, errors: extracted.errors },
    author_trusted: !!extracted.comment,
  };

  if (!proof) {
    printJson(out, opts.pretty);
    fail('no proof found in issue comments');
  }

  if (opts.verify) {
    const currentPublicKey = parsed.identity?.public_key;
    if (!currentPublicKey) fail('creamlon.yaml has no identity.public_key');
    const rotationsText = await getRepositoryFile(
      owner,
      repo,
      'trust/key-rotations.log',
      opts.ref || 'main',
      token,
      { optional: true },
    );
    const continuity = inspectKeyContinuity(rotationsText, currentPublicKey);
    if (continuity.status === 'broken') {
      fail(`invalid key rotation chain: ${continuity.errors.join('; ')}`);
    }
    const publicKeyB64 = publicKeyAt(continuity.history, proof.completed_at);
    if (!publicKeyB64) fail('no public key valid at proof completion time');
    const publicKey = publicKeyFromBase64Url(publicKeyB64);
    out.verify = verifyProof(proof, publicKey);
    out.signature_ok = out.verify.ok;
    out.binding_ok = out.binding.ok;
    out.key_continuity = continuity.status;
  }

  printJson(out, opts.pretty);
  if (opts.verify && !out.verify.ok) {
    fail(out.verify.reason || 'verification failed');
  }
}

async function auditRepository(repoPath) {
  const manifest = parseManifest(await readFile(join(repoPath, 'creamlon.yaml'), 'utf8'));
  const manifestErrors = validateManifest(manifest, { requireGithubProfile: true });
  const rotationsText = await readFile(join(repoPath, 'trust', 'key-rotations.log'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const continuity = manifestErrors.length === 0
    ? inspectKeyContinuity(rotationsText, manifest.identity.public_key)
    : { status: 'broken', errors: ['invalid creamlon.yaml'], history: [] };
  const logText = await readFile(join(repoPath, 'trust', 'proofs.log'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const redemptionsText = await readFile(join(repoPath, 'trust', 'redemptions.log'), 'utf8')
    .catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  const redemptionEntries = [];
  const redemptionByCredential = new Map();
  const redemptionByRequest = new Map();
  let redemptionLine = 0;
  for (const line of redemptionsText.split('\n')) {
    redemptionLine += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const redemption = JSON.parse(trimmed);
      const errors = validateRedemption(redemption);
      if (redemptionByCredential.has(redemption.credential_id)) {
        errors.push('duplicate redemption credential_id');
      }
      if (redemptionByRequest.has(redemption.request_id)) {
        errors.push('duplicate redemption request_id');
      }
      if (!errors.length) {
        redemptionByCredential.set(redemption.credential_id, redemption);
        redemptionByRequest.set(redemption.request_id, redemption);
      }
      redemptionEntries.push({
        line: redemptionLine,
        request_id: redemption.request_id,
        credential_id: redemption.credential_id,
        errors,
      });
    } catch (error) {
      redemptionEntries.push({ line: redemptionLine, errors: [error.message] });
    }
  }
  const entries = [];
  const seen = new Map();
  const proofByRequest = new Map();
  let lineNumber = 0;
  for (const line of logText.split('\n')) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const proof = parseProofJson(trimmed);
      const publicKeyBase64Url = publicKeyAt(continuity.history, proof.completed_at);
      const verify = publicKeyBase64Url
        ? verifyProof(proof, publicKeyFromBase64Url(publicKeyBase64Url))
        : { ok: false, reason: 'no valid public key for proof timestamp' };
      const previous = seen.get(proof.request_id);
      const duplicate = previous ? (sameProof(previous, proof) ? 'same' : 'conflict') : null;
      const redemption = redemptionByRequest.get(proof.request_id);
      if (proof.credential_digest && (
        !redemption
        || redemption.credential_digest !== proof.credential_digest
        || redemption.task_intent_digest !== proof.task_intent_digest
      )) {
        verify.ok = false;
        verify.reason = 'proof credential fields do not match redemptions.log';
      }
      if (!previous) seen.set(proof.request_id, proof);
      if (!proofByRequest.has(proof.request_id)) proofByRequest.set(proof.request_id, proof);
      entries.push({ line: lineNumber, request_id: proof.request_id, verify, duplicate });
    } catch (error) {
      entries.push({ line: lineNumber, verify: { ok: false, reason: error.message }, duplicate: null });
    }
  }
  for (const entry of redemptionEntries) {
    if (entry.errors.length) continue;
    const redemption = redemptionByCredential.get(entry.credential_id);
    const proof = proofByRequest.get(entry.request_id);
    if (!proof
      || proof.credential_digest !== redemption.credential_digest
      || proof.task_intent_digest !== redemption.task_intent_digest) {
      entry.errors.push('redemption does not match a credential proof');
    }
  }
  const ok = manifestErrors.length === 0
    && continuity.status !== 'broken'
    && entries.every((entry) => entry.verify.ok && entry.duplicate == null)
    && redemptionEntries.every((entry) => entry.errors.length === 0);
  return {
    ok,
    manifest_errors: manifestErrors,
    key_continuity: continuity.status,
    key_errors: continuity.errors,
    proof_count: entries.length,
    entries,
    redemption_count: redemptionEntries.length,
    redemptions: redemptionEntries,
  };
}

async function cmdAudit(opts) {
  const result = await auditRepository(resolve(opts.repoPath || '.'));
  printJson(result, opts.pretty);
  if (!result.ok) fail('audit failed');
}

async function cmdStatus(opts) {
  const repoPath = resolve(opts.repoPath || '.');
  const manifest = parseManifest(await readFile(join(repoPath, 'creamlon.yaml'), 'utf8'));
  const result = await auditRepository(repoPath);
  const status = {
    version: manifest.version,
    status: manifest.status,
    checked_at: new Date().toISOString(),
    proofs_valid: result.ok,
  };
  const outPath = resolve(opts.statusOut || join(repoPath, 'trust', 'status.json'));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  printJson({ ...status, path: outPath }, opts.pretty);
  if (!result.ok) fail('status written, but audit failed');
}

async function cmdKeyRotate(opts) {
  if (!opts.oldPublicKey) throw usageError('key-rotate requires --old-public-key');
  if (!opts.newPublicKey) throw usageError('key-rotate requires --new-public-key');
  if (opts.oldPublicKey === opts.newPublicKey) fail('old and new public keys must differ');
  const rotatedAt = opts.rotatedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(rotatedAt))) throw usageError('key-rotate --rotated-at must be an ISO timestamp');
  if (Date.parse(rotatedAt) > Date.now() + 5 * 60 * 1000) {
    throw usageError('key-rotate --rotated-at cannot be in the future');
  }
  const repoPath = resolve(opts.repoPath || '.');
  const privateKey = await readPrivateKeyFile(opts.key || join(repoPath, '.creamlon', 'private.key'));
  const signingPublicKey = publicKeyToBase64Url(createPublicKey(privateKey));
  if (signingPublicKey !== opts.oldPublicKey) {
    fail('private key does not match --old-public-key');
  }
  const manifest = parseManifest(await readFile(join(repoPath, 'creamlon.yaml'), 'utf8'));
  const manifestErrors = validateManifest(manifest, { requireGithubProfile: true });
  if (manifestErrors.length) fail(`invalid creamlon.yaml: ${manifestErrors.join('; ')}`);
  if (manifest.identity.public_key !== opts.newPublicKey) {
    fail('--new-public-key must match creamlon.yaml identity.public_key');
  }
  const logPath = join(repoPath, 'trust', 'key-rotations.log');
  const existingText = await readFile(logPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const existing = inspectKeyContinuity(existingText, opts.oldPublicKey);
  if (existing.status === 'broken') {
    fail(`existing key rotation chain is broken: ${existing.errors.join('; ')}`);
  }
  const rotation = signKeyRotation({
    oldPublicKey: opts.oldPublicKey,
    newPublicKey: opts.newPublicKey,
    rotatedAt,
  }, privateKey);
  const candidateText = `${existingText.trimEnd()}${existingText.trim() ? '\n' : ''}${JSON.stringify(rotation)}\n`;
  const candidate = inspectKeyContinuity(candidateText, opts.newPublicKey);
  if (candidate.status === 'broken') {
    fail(`new key rotation would break the chain: ${candidate.errors.join('; ')}`);
  }
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, candidateText, 'utf8');
  printJson({ ...rotation, path: logPath }, opts.pretty);
}

async function cmdHmacKeyNew(opts) {
  if (!opts.authorizationKeyId) throw usageError('hmac-key-new requires --key-id');
  const outPath = resolve(opts.out || '.creamlon/authorization.keys.json');
  let keys = {};
  try {
    keys = JSON.parse(await readFile(outPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (keys[opts.authorizationKeyId]) {
    fail(`authorization key already exists: ${opts.authorizationKeyId}`, 4);
  }
  keys[opts.authorizationKeyId] = generateHmacSecret(randomBytes(32));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(keys, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  await chmod(outPath, 0o600);
  console.log(`HMAC authorization key written to ${outPath}`);
}

async function cmdCredential(positional, opts) {
  const action = positional[1];
  const { storePath, redemptionsPath } = credentialPaths(opts);
  const redemptions = await loadRedemptions(redemptionsPath);

  if (action === 'create') {
    if (!opts.capabilityId) throw usageError('credential create requires --capability-id');
    if (opts.expires && Number.isNaN(Date.parse(opts.expires))) {
      throw usageError('credential create --expires must be an ISO timestamp');
    }
    const generated = generateCredential();
    const record = {
      credential_id: generated.credential_id,
      secret: generated.secret,
      capability_id: opts.capabilityId,
      status: 'available',
      created_at: new Date().toISOString(),
      expires: opts.expires || null,
    };
    await updateCredentialStore(storePath, (store) => {
      store.credentials.push(record);
    });
    printJson({
      credential: generated.value,
      ...publicCredentialRecord(record, redemptions),
      store: storePath,
      warning: 'Keep the complete credential secret. It will not be shown by credential list.',
    }, opts.pretty);
    return;
  }

  if (action === 'list') {
    const store = await loadCredentialStore(storePath);
    printJson({
      store: storePath,
      credentials: store.credentials.map((record) => publicCredentialRecord(record, redemptions)),
    }, opts.pretty);
    return;
  }

  if (action === 'revoke') {
    const credentialId = positional[2];
    if (!credentialId) throw usageError('credential revoke requires <credential-id>');
    if (redemptions.some((item) => item.credential_id === credentialId)) {
      fail('cannot revoke a redeemed credential', 4);
    }
    let record;
    await updateCredentialStore(storePath, (store) => {
      record = findCredential(store, credentialId);
      if (!record) fail(`unknown credential_id: ${credentialId}`, 4);
      record.status = 'revoked';
      record.revoked_at = new Date().toISOString();
    });
    printJson(publicCredentialRecord(record, redemptions), opts.pretty);
    return;
  }

  throw usageError('credential requires create, list, or revoke');
}

async function copyTemplate(src, dest, name) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const outputName = entry.name === 'SKILL.template.md' ? 'SKILL.md' : entry.name;
    const destPath = join(dest, outputName);
    if (entry.isDirectory()) {
      await copyTemplate(srcPath, destPath, name);
    } else {
      let content = await readFile(srcPath, 'utf8');
      content = content.replaceAll('{{name}}', name);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content, 'utf8');
    }
  }
}

async function cmdInit(positional, opts) {
  const dir = positional[1];
  if (!dir) throw usageError('init requires <dir>');
  const name = opts.name || 'my-agent';
  const dest = resolve(dir);
  try {
    const s = await stat(dest);
    if (s.isFile()) fail(`path is a file, not a directory: ${dest}`);
    const existing = await readdir(dest);
    if (existing.length > 0) fail(`directory not empty: ${dest}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await copyTemplate(TEMPLATE_DIR, dest, name);
  console.log(`Created agent node at ${dest}`);
  console.log(`Next: creamlon keygen --out ${join(dest, '.creamlon')}`);
  console.log('Then paste public_key into creamlon.yaml and push to GitHub.');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw usageError('verify requires --proof or stdin');
  return text;
}

export async function runCli(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    const topic = rest[0];
    const helpKey = topic === 'hmac-key-new' ? 'hmacKeyNew'
      : topic === 'fetch-proof' ? 'fetchProof'
        : topic === 'key-rotate' ? 'keyRotate'
          : topic === 'extension' && rest[1] === 'delivery' ? 'extensionDelivery'
            : topic === 'caller' ? 'caller'
            : topic;
    console.log(helpKey && HELP[helpKey] ? HELP[helpKey] : HELP.main);
    return;
  }

  const { positional, opts } = parseArgs([cmd, ...rest]);
  const command = positional[0];

  switch (command) {
    case 'keygen':
      await cmdKeygen(opts);
      break;
    case 'key-rotate':
      await cmdKeyRotate(opts);
      break;
    case 'hmac-key-new':
      await cmdHmacKeyNew(opts);
      break;
    case 'credential':
      await cmdCredential(positional, opts);
      break;
    case 'hash':
      await cmdHash(positional, opts);
      break;
    case 'sign':
      await cmdSign(opts);
      break;
    case 'verify':
      await cmdVerify(opts);
      break;
    case 'inspect':
      await cmdInspect(positional, opts);
      break;
    case 'discover':
      await cmdDiscover(positional, opts);
      break;
    case 'submit':
      await cmdSubmit(positional, opts);
      break;
    case 'watch':
      await cmdWatch(positional, opts);
      break;
    case 'deliver':
      await cmdDeliver(positional, opts);
      break;
    case 'reject':
      await cmdReject(positional, opts);
      break;
    case 'fetch-proof':
      await cmdFetchProof(positional, opts);
      break;
    case 'audit':
      await cmdAudit(opts);
      break;
    case 'status':
      await cmdStatus(opts);
      break;
    case 'init':
      await cmdInit(positional, opts);
      break;
    case 'caller':
      await cmdCaller(positional, opts, {
        loadManifestContext,
        resolveToken,
        printJson,
      });
      break;
    case 'extension':
      await cmdExtension(positional, opts, {
        loadManifestContext,
        resolveToken,
        printJson,
      });
      break;
    default:
      throw usageError(`unknown command: ${command}`);
  }
}
