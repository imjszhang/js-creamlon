import { readFile, writeFile, mkdir, readdir, stat, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, randomUUID, randomBytes } from 'node:crypto';
import { hashText, hashFile, assertValidHashDigest } from '../lib/hash.mjs';
import { fetchAgentYaml, parseAgentYaml, parseRepoSlug, validateAgentYaml } from '../lib/agentYaml.mjs';
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
  parseTaskYaml,
  validateTaskYaml,
  resolveInputHash,
  serializeTaskYaml,
  taskIssueTitle,
  isTaskIssue,
} from '../lib/taskYaml.mjs';
import { loadProcessedIds } from '../lib/dedup.mjs';
import { validateTaskAcceptance } from '../lib/acceptance.mjs';
import {
  generateHmacSecret,
  loadHmacKeys,
  signHmacPayment,
} from '../lib/payment.mjs';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'template', 'agent-node');
const VALUE_OPTIONS = new Set([
  '--out', '--file', '--request-id', '--capability-id', '--input-hash', '--output-hash',
  '--input', '--input-ref-url', '--requester', '--expires',
  '--payment-key-id', '--key-id',
  '--payment-expires', '--keys', '--reason', '--repo-path', '--output-file', '--key',
  '--completed-at', '--repo', '--public-key', '--proof', '--name', '--ref', '--token',
  '--input-type', '--output-type', '--status', '--limit', '--sort', '--cache-ttl',
  '--old-public-key', '--new-public-key', '--rotated-at', '--status-out',
]);

const HELP = {
  main: `Creamlon - Creamlon protocol CLI v0.3.1

Usage:
  creamlon <command> [options]

Commands:
  keygen [--out <dir>]              Generate Ed25519 key pair
  key-rotate [options]              Record a signed public-key rotation
  payment-key-new [options]         Generate HMAC payment key
  hash <text>                       Hash text as sha256:...
  hash --file <path>                Hash file contents
  sign [options]                    Sign and output proof JSON
  verify [options]                  Verify proof signature
  inspect <owner/repo>              Fetch and show agent.yaml
  discover <capability-id>          Find nodes via GitHub Topic search
  submit <owner/repo> [options]     Create task Issue (needs GITHUB_TOKEN)
  watch <owner/repo> [options]      List pending tasks (needs GITHUB_TOKEN)
  deliver <owner/repo> <issue#>     Sign and deliver proof (needs GITHUB_TOKEN)
  reject <owner/repo> <issue#>      Reject task Issue (needs GITHUB_TOKEN)
  fetch-proof <owner/repo> <issue#> Extract proof from Issue comments
  audit [--repo-path <dir>]          Audit local proofs.log
  status [--repo-path <dir>]         Write public node health status
  init <dir> [--name <name>]        Scaffold agent node from template
  help [command]                    Show help

submit/watch/deliver/reject/fetch-proof require GITHUB_TOKEN or --token.
Run "creamlon help <command>" for details.`,
  keygen: `creamlon keygen [--out <dir>]

Generate Ed25519 key pair. Writes public.key, private.key, public.b64url to --out (default: .creamlon).`,
  keyRotate: `creamlon key-rotate [options]

Options:
  --old-public-key <b64>  Previous public key
  --new-public-key <b64>  New public key now published in agent.yaml
  --key <path>            Previous private key (default: .creamlon/private.key)
  --rotated-at <iso>      Optional rotation timestamp
  --repo-path <dir>       Node repository (default: .)

Appends a signed record to trust/key-rotations.log.`,
  paymentKeyNew: `creamlon payment-key-new --key-id <id> [--out <path>]

Generate an HMAC payment key in JSON format (default: .creamlon/payment.keys.json).`,
  hash: `creamlon hash <text>
creamlon hash --file <path>

Compute sha256:... digest for proof input_hash / output_hash.
Multi-word text is joined with spaces; quote text that contains shell metacharacters.`,
  sign: `creamlon sign [options]

Options:
  --request-id <uuid>
  --capability-id <id>
  --input-hash <sha256:...>
  --output-hash <sha256:...>
  --key <path>          Private key file (default: .creamlon/private.key)
  --completed-at <iso>  Optional ISO timestamp
  --pretty              Pretty-print JSON`,
  verify: `creamlon verify [options]

Options:
  --repo <owner/repo>   Fetch public_key from agent.yaml
  --ref <branch>        Git branch (default: main)
  --token <pat>         Load key rotations for historical proofs
  --public-key <b64>    Or supply public key directly
  --proof <path>        Proof JSON file (or stdin if omitted)
  --pretty              Pretty-print JSON result`,
  inspect: `creamlon inspect <owner/repo> [--ref main]

Fetch agent.yaml from GitHub and display capabilities.`,
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
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty`,
  submit: `creamlon submit <owner/repo> [options]

Options:
  --capability-id <id>   Required
  --requester <github:user/repo>  Required
  --input <text>         Task input (or --input-hash / --input-ref-url)
  --input-hash <sha256:...>
  --input-ref-url <url>
  --request-id <uuid>    Default: random UUID
  --expires <iso>        Optional expiry
  --payment-key-id <id>  Required; sign HMAC payment during submit
  --keys <path>          Required; private HMAC key map
  --payment-expires <iso> Required; HMAC credential expiry
  --ref <branch>         agent.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty               Pretty-print result JSON`,
  watch: `creamlon watch <owner/repo> [options]

Options:
  --repo-path <dir>      Local node dir for proofs.log and HMAC keys
  --keys <path>          HMAC key map
  --ref <branch>         agent.yaml branch (default: main)
  --once                 Poll once and exit (default)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty               Pretty-print JSON`,
  deliver: `creamlon deliver <owner/repo> <issue-number> [options]

Options:
  --output-file <path>   Hash deliverable file for output_hash (required)
  --repo-path <dir>      Local node dir (default: .)
  --keys <path>          HMAC key map
  --key <path>           Private key (default: <repo-path>/.creamlon/private.key)
  --ref <branch>         agent.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --dry-run              Print proof only; no GitHub or file writes
  --resume               Resume a partially completed delivery
  --pretty               Pretty-print JSON`,
  reject: `creamlon reject <owner/repo> <issue-number> [options]

Options:
  --reason <text>        Rejection reason (default: validation errors joined)
  --repo-path <dir>      Local node dir for proofs.log and HMAC keys
  --keys <path>          HMAC key map
  --ref <branch>         agent.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty               Pretty-print JSON`,
  fetchProof: `creamlon fetch-proof <owner/repo> <issue-number> [options]

Options:
  --verify               Verify proof signature against agent.yaml public_key
  --ref <branch>         agent.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty               Pretty-print JSON`,
  audit: `creamlon audit [--repo-path <dir>] [--pretty]

Validate local agent.yaml and every proof in trust/proofs.log. Reports malformed, invalid, and duplicate entries.`,
  status: `creamlon status [--repo-path <dir>] [--status-out <path>] [--pretty]

Audit the node and write trust/status.json for discovery. The output path defaults to <repo-path>/trust/status.json.`,
  init: `creamlon init <dir> [--name <name>]

Copy template/agent-node/ to <dir> and replace {{name}} placeholders.`,
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
    else if (arg === '--input-hash') { i += 1; opts.inputHash = argv[i]; }
    else if (arg === '--output-hash') { i += 1; opts.outputHash = argv[i]; }
    else if (arg === '--input') { i += 1; opts.input = argv[i]; }
    else if (arg === '--input-ref-url') { i += 1; opts.inputRefUrl = argv[i]; }
    else if (arg === '--requester') { i += 1; opts.requester = argv[i]; }
    else if (arg === '--expires') { i += 1; opts.expires = argv[i]; }
    else if (arg === '--payment-key-id' || arg === '--key-id') { i += 1; opts.paymentKeyId = argv[i]; }
    else if (arg === '--payment-expires') { i += 1; opts.paymentExpires = argv[i]; }
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

async function loadAgentContext(slug, ref) {
  const { owner, repo } = parseRepoSlug(slug);
  const { parsed } = await fetchAgentYaml(owner, repo, ref || 'main');
  const agentErrors = validateAgentYaml(parsed);
  if (agentErrors.length) {
    fail(`invalid agent.yaml: ${agentErrors.join('; ')}`);
  }
  return { owner, repo, parsed };
}

async function loadPaymentSecrets(opts) {
  const repoPath = resolve(opts.repoPath || '.');
  const hmacKeys = await loadHmacKeys(opts.keys || join(repoPath, '.creamlon', 'payment.keys.json'));
  return { hmacKeys };
}

async function cmdKeygen(opts) {
  const outDir = opts.out || '.creamlon';
  const result = await generateKeyPair(outDir);
  console.log(`Keys written to ${outDir}/`);
  console.log(`public_key (base64url): ${result.publicKeyBase64Url}`);
  console.log('Keep private.key secret; add public_key to agent.yaml');
}

async function cmdHash(positional, opts) {
  if (opts.file) {
    const digest = await hashFile(opts.file);
    console.log(digest);
    return;
  }
  const text = positional.slice(1).join(' ');
  if (!text) throw usageError('hash requires <text> or --file');
  console.log(hashText(text));
}

async function cmdSign(opts) {
  const keyPath = opts.key || '.creamlon/private.key';
  const required = ['requestId', 'capabilityId', 'inputHash', 'outputHash'];
  for (const k of required) {
    if (!opts[k]) throw usageError(`sign requires --${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  }
  assertValidHashDigest(opts.inputHash, 'input_hash');
  assertValidHashDigest(opts.outputHash, 'output_hash');
  const privateKey = await readPrivateKeyFile(keyPath);
  const fields = buildProofFields({
    requestId: opts.requestId,
    capabilityId: opts.capabilityId,
    inputHash: opts.inputHash,
    outputHash: opts.outputHash,
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
    const { parsed } = await fetchAgentYaml(owner, repo, opts.ref || 'main');
    publicKeyB64 = parsed.creamlon?.public_key;
    if (!publicKeyB64) fail('agent.yaml has no creamlon.public_key');
    const token = resolveToken(opts);
    if (token) {
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
  const { parsed, url } = await fetchAgentYaml(owner, repo, opts.ref || 'main');
  const errors = validateAgentYaml(parsed);
  const out = {
    repo: `${owner}/${repo}`,
    url,
    name: parsed.name,
    description: parsed.description,
    creamlon: parsed.creamlon,
    public_key_fingerprint: null,
    valid: errors.length === 0,
    errors,
  };
  if (out.valid) out.public_key_fingerprint = publicKeyFingerprint(parsed.creamlon.public_key);
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
    schema: 2,
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
  const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);
  const capIds = parsed.creamlon?.capabilities?.map((c) => c.id) || [];
  const task = {
    request_id: opts.requestId || randomUUID(),
    capability_id: opts.capabilityId,
    requester: opts.requester,
    expires: opts.expires || null,
    payment: null,
    input: null,
    input_hash: null,
    input_ref: null,
  };

  const inputModes = [opts.input, opts.inputHash, opts.inputRefUrl].filter((v) => v != null);
  if (inputModes.length === 0) throw usageError('submit requires --input, --input-hash, or --input-ref-url');
  if (inputModes.length > 1) throw usageError('submit: only one input mode allowed');

  if (opts.input) task.input = opts.input;
  if (opts.inputHash) task.input_hash = opts.inputHash;
  if (opts.inputRefUrl) task.input_ref = { type: 'url', value: opts.inputRefUrl };

  if (!opts.paymentKeyId) throw usageError('submit requires --payment-key-id');
  if (!opts.paymentExpires) throw usageError('submit requires --payment-expires');
  if (!opts.keys) throw usageError('submit requires --keys');
  const keys = await loadHmacKeys(opts.keys);
  const secret = keys.get(opts.paymentKeyId);
  if (!secret) throw usageError(`no payment secret configured for key_id: ${opts.paymentKeyId}`);
  task.payment = signHmacPayment(task, {
    keyId: opts.paymentKeyId,
    secret,
    expires: opts.paymentExpires,
  });

  const errors = validateTaskYaml(task, {
    capability_ids: capIds,
  });
  if (errors.length) fail(`invalid task: ${errors.join('; ')}`);

  const body = serializeTaskYaml(task);
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
  const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);
  const paymentSecrets = await loadPaymentSecrets(opts);

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
      const task = parseTaskYaml(issue.body || '');
      const acceptance = validateTaskAcceptance(task, issue, {
        agentParsed: parsed,
        processedIds: processed,
        paymentSecrets,
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
        payment_ok: acceptance.payment_ok,
        payment_error: acceptance.payment_error,
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
        payment_ok: false,
        payment_error: null,
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
  const statePath = join(repoPath, '.creamlon', 'deliveries', `${issueNumber}.json`);
  const lockPath = join(repoPath, '.creamlon', 'deliver.lock');
  const releaseLock = opts.dryRun ? null : await acquireDeliveryLock(lockPath);

  try {
    const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);
    const paymentSecrets = await loadPaymentSecrets(opts);
    const issue = await getIssue(owner, repo, issueNumber, token);
    const task = parseTaskYaml(issue.body || '');
    const existingState = await readDeliveryState(statePath);
    if (opts.resume && !existingState) fail('no delivery state to resume', 4);

    const processed = await loadProcessedIds(proofsPath);
    const acceptance = validateTaskAcceptance(task, issue, {
      agentParsed: parsed,
      processedIds: existingState ? null : processed,
      paymentSecrets,
      checkIssueMeta: !existingState,
    });
    if (acceptance.errors.length) fail(`cannot deliver: ${acceptance.errors.join('; ')}`);

    const inputHash = resolveInputHash(task);
    const outputHash = await hashFile(opts.outputFile);
    let proof = existingState?.proof || null;
    if (proof) {
      const binding = verifyProofBinding(proof, task, inputHash);
      if (!binding.ok || proof.output_hash !== outputHash) {
        fail('stored delivery state conflicts with task or output', 4);
      }
    } else {
      const privateKey = await readPrivateKeyFile(keyPath);
      proof = signProof(buildProofFields({
        requestId: task.request_id,
        capabilityId: task.capability_id,
        inputHash,
        outputHash,
        completedAt: opts.completedAt,
      }), privateKey);
    }

    if (opts.dryRun) {
      printJson({ ok: true, dry_run: true, proof }, opts.pretty);
      return;
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
      const remote = extractBoundProofFromComments(comments, task, inputHash);
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
      proof,
      next_steps: [
        `git -C ${repoPath} add trust/proofs.log`,
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

  const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);
  const paymentSecrets = await loadPaymentSecrets(opts);

  const issue = await getIssue(owner, repo, issueNumber, token);
  const task = parseTaskYaml(issue.body || '');

  const processed = await loadProcessedIds(proofsPath);
  const acceptance = validateTaskAcceptance(task, issue, {
    agentParsed: parsed,
    processedIds: processed,
    paymentSecrets,
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
  const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);

  const [issue, comments] = await Promise.all([
    getIssue(owner, repo, issueNumber, token),
    getIssueComments(owner, repo, issueNumber, token),
  ]);
  const task = parseTaskYaml(issue.body || '');
  const taskErrors = validateTaskYaml(task, {
    capability_ids: parsed.creamlon?.capabilities?.map((cap) => cap.id) || [],
  });
  if (taskErrors.length) fail(`invalid issue task: ${taskErrors.join('; ')}`);
  if (issue.title !== taskIssueTitle(task.capability_id)) {
    fail('issue title capability does not match task capability_id');
  }
  const inputHash = resolveInputHash(task);
  const extracted = extractBoundProofFromComments(comments, task, inputHash);
  const proof = extracted.proof;

  const out = {
    ok: !!proof,
    issue_number: Number(issueNumber),
    proof,
    binding: proof ? verifyProofBinding(proof, task, inputHash) : { ok: false, errors: extracted.errors },
    author_trusted: !!extracted.comment,
  };

  if (!proof) {
    printJson(out, opts.pretty);
    fail('no proof found in issue comments');
  }

  if (opts.verify) {
    const currentPublicKey = parsed.creamlon?.public_key;
    if (!currentPublicKey) fail('agent.yaml has no creamlon.public_key');
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
  const parsedAgent = parseAgentYaml(await readFile(join(repoPath, 'agent.yaml'), 'utf8'));
  const agentErrors = validateAgentYaml(parsedAgent);
  const rotationsText = await readFile(join(repoPath, 'trust', 'key-rotations.log'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const continuity = agentErrors.length === 0
    ? inspectKeyContinuity(rotationsText, parsedAgent.creamlon.public_key)
    : { status: 'broken', errors: ['invalid agent.yaml'], history: [] };
  const logText = await readFile(join(repoPath, 'trust', 'proofs.log'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const entries = [];
  const seen = new Map();
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
      if (!previous) seen.set(proof.request_id, proof);
      entries.push({ line: lineNumber, request_id: proof.request_id, verify, duplicate });
    } catch (error) {
      entries.push({ line: lineNumber, verify: { ok: false, reason: error.message }, duplicate: null });
    }
  }
  const ok = agentErrors.length === 0
    && continuity.status !== 'broken'
    && entries.every((entry) => entry.verify.ok && entry.duplicate == null);
  return {
    ok,
    agent_errors: agentErrors,
    key_continuity: continuity.status,
    key_errors: continuity.errors,
    proof_count: entries.length,
    entries,
  };
}

async function cmdAudit(opts) {
  const result = await auditRepository(resolve(opts.repoPath || '.'));
  printJson(result, opts.pretty);
  if (!result.ok) fail('audit failed');
}

async function cmdStatus(opts) {
  const repoPath = resolve(opts.repoPath || '.');
  const parsedAgent = parseAgentYaml(await readFile(join(repoPath, 'agent.yaml'), 'utf8'));
  const result = await auditRepository(repoPath);
  const status = {
    v: parsedAgent.creamlon?.version || null,
    status: parsedAgent.creamlon?.status || null,
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
  const parsedAgent = parseAgentYaml(await readFile(join(repoPath, 'agent.yaml'), 'utf8'));
  const agentErrors = validateAgentYaml(parsedAgent);
  if (agentErrors.length) fail(`invalid agent.yaml: ${agentErrors.join('; ')}`);
  if (parsedAgent.creamlon.public_key !== opts.newPublicKey) {
    fail('--new-public-key must match agent.yaml creamlon.public_key');
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

async function cmdPaymentKeyNew(opts) {
  if (!opts.paymentKeyId) throw usageError('payment-key-new requires --key-id');
  const outPath = resolve(opts.out || '.creamlon/payment.keys.json');
  let keys = {};
  try {
    keys = JSON.parse(await readFile(outPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (keys[opts.paymentKeyId]) fail(`payment key already exists: ${opts.paymentKeyId}`, 4);
  keys[opts.paymentKeyId] = generateHmacSecret(randomBytes(32));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(keys, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  console.log(`HMAC payment key written to ${outPath}`);
}

async function copyTemplate(src, dest, name) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
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
  console.log(`Next: creamlon payment-key-new --key-id customer-1 --out ${join(dest, '.creamlon', 'payment.keys.json')}`);
  console.log('Then paste public_key into agent.yaml and push to GitHub.');
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
    const helpKey = topic === 'payment-key-new' ? 'paymentKeyNew'
      : topic === 'fetch-proof' ? 'fetchProof'
        : topic === 'key-rotate' ? 'keyRotate' : topic;
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
    case 'payment-key-new':
      await cmdPaymentKeyNew(opts);
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
    default:
      throw usageError(`unknown command: ${command}`);
  }
}
