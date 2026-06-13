import { readFile, writeFile, mkdir, readdir, stat, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hashText, hashFile, assertValidHashDigest } from '../lib/hash.mjs';
import { fetchAgentYaml, parseRepoSlug, validateAgentYaml } from '../lib/agentYaml.mjs';
import {
  buildProofFields,
  generateKeyPair,
  parseProofJson,
  publicKeyFromBase64Url,
  readPrivateKeyFile,
  signProof,
  verifyProof,
} from '../lib/proof.mjs';
import {
  parseTaskYaml,
  validateTaskYaml,
  isExpired,
  resolveInputHash,
  serializeTaskYaml,
  taskIssueTitle,
  isTaskIssue,
} from '../lib/taskYaml.mjs';
import { loadProcessedIds, hasProcessed } from '../lib/dedup.mjs';
import {
  createIssue,
  listIssues,
  getIssue,
  createIssueComment,
  closeIssue,
  getGithubToken,
} from '../lib/github.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'template', 'agent-node');

const HELP = {
  main: `Creamlon - Creamlon protocol CLI v0.2

Usage:
  creamlon <command> [options]

Commands:
  keygen [--out <dir>]              Generate Ed25519 key pair
  hash <text>                       Hash text as sha256:...
  hash --file <path>                Hash file contents
  sign [options]                    Sign and output proof JSON
  verify [options]                  Verify proof signature
  inspect <owner/repo>              Fetch and show agent.yaml
  submit <owner/repo> [options]     Create task Issue (needs GITHUB_TOKEN)
  watch <owner/repo> [options]      List pending tasks (needs GITHUB_TOKEN)
  deliver <owner/repo> <issue#>     Sign and deliver proof (needs GITHUB_TOKEN)
  init <dir> [--name <name>]        Scaffold agent node from template
  help [command]                    Show help

submit/watch/deliver require GITHUB_TOKEN or --token.
Run "creamlon help <command>" for details.`,
  keygen: `creamlon keygen [--out <dir>]

Generate Ed25519 key pair. Writes public.key, private.key, public.b64url to --out (default: .creamlon).`,
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
  --public-key <b64>    Or supply public key directly
  --proof <path>        Proof JSON file (or stdin if omitted)
  --pretty              Pretty-print JSON result`,
  inspect: `creamlon inspect <owner/repo> [--ref main]

Fetch agent.yaml from GitHub and display capabilities.`,
  submit: `creamlon submit <owner/repo> [options]

Options:
  --capability-id <id>   Required
  --requester <github:user/repo>  Required
  --input <text>         Task input (or --input-hash / --input-ref-url)
  --input-hash <sha256:...>
  --input-ref-url <url>
  --request-id <uuid>    Default: random UUID
  --expires <iso>        Optional expiry
  --payment-json <path>  JSON file for payment field
  --ref <branch>         agent.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty               Pretty-print result JSON`,
  watch: `creamlon watch <owner/repo> [options]

Options:
  --repo-path <dir>      Local node dir for proofs.log dedup (optional)
  --ref <branch>         agent.yaml branch (default: main)
  --once                 Poll once and exit (default)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --pretty               Pretty-print JSON`,
  deliver: `creamlon deliver <owner/repo> <issue-number> [options]

Options:
  --output-file <path>   Hash deliverable file for output_hash (required)
  --repo-path <dir>      Local node dir (default: .)
  --key <path>           Private key (default: <repo-path>/.creamlon/private.key)
  --ref <branch>         agent.yaml branch (default: main)
  --token <pat>          GitHub token (or GITHUB_TOKEN)
  --dry-run              Print proof only; no GitHub or file writes
  --pretty               Pretty-print JSON`,
  init: `creamlon init <dir> [--name <name>]

Copy template/agent-node/ to <dir> and replace {{name}} placeholders.`,
};

function parseArgs(argv) {
  const positional = [];
  const opts = { pretty: false, once: true, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pretty') opts.pretty = true;
    else if (arg === '--once') opts.once = true;
    else if (arg === '--dry-run') opts.dryRun = true;
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
    else if (arg === '--payment-json') { i += 1; opts.paymentJson = argv[i]; }
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
  return { owner, repo, parsed };
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
  if (opts.repo) {
    const { owner, repo } = parseRepoSlug(opts.repo);
    const { parsed } = await fetchAgentYaml(owner, repo, opts.ref || 'main');
    publicKeyB64 = parsed.creamlon?.public_key;
    if (!publicKeyB64) fail('agent.yaml has no creamlon.public_key');
  }
  if (!publicKeyB64) throw usageError('verify requires --repo or --public-key');

  const publicKey = publicKeyFromBase64Url(publicKeyB64);
  const result = verifyProof(proof, publicKey);
  if (opts.pretty || !result.ok) {
    printJson({ ...result, request_id: proof.request_id }, opts.pretty);
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
    valid: errors.length === 0,
    errors,
  };
  printJson(out, opts.pretty);
}

async function cmdSubmit(positional, opts) {
  const slug = positional[1];
  if (!slug) throw usageError('submit requires <owner/repo>');
  if (!opts.capabilityId) throw usageError('submit requires --capability-id');
  if (!opts.requester) throw usageError('submit requires --requester');

  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);
  const capIds = parsed.creamlon?.capabilities?.map((c) => c.id) || [];
  const paymentRequired = parsed.creamlon?.payment_required === true;

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

  if (opts.paymentJson) {
    const raw = await readFile(opts.paymentJson, 'utf8');
    task.payment = JSON.parse(raw);
  }

  const errors = validateTaskYaml(task, {
    payment_required: paymentRequired,
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
  const capIds = parsed.creamlon?.capabilities?.map((c) => c.id) || [];
  const paymentRequired = parsed.creamlon?.payment_required === true;

  let processed = new Set();
  if (opts.repoPath) {
    const proofsPath = join(resolve(opts.repoPath), 'trust', 'proofs.log');
    processed = await loadProcessedIds(proofsPath);
  }

  const issues = await listIssues(owner, repo, { state: 'open', token });
  const taskIssues = issues.filter((i) => isTaskIssue(i.title) && !i.pull_request);

  const results = [];
  for (const issue of taskIssues) {
    const task = parseTaskYaml(issue.body || '');
    const errors = validateTaskYaml(task, {
      payment_required: paymentRequired,
      capability_ids: capIds,
    });

    if (task.request_id && hasProcessed(processed, task.request_id)) {
      errors.push('duplicate request_id in proofs.log');
    }
    if (isExpired(task)) errors.push('task expired');

    results.push({
      issue_number: issue.number,
      issue_url: issue.html_url,
      title: issue.title,
      request_id: task.request_id,
      capability_id: task.capability_id,
      requester: task.requester,
      valid: errors.length === 0,
      errors,
    });
  }

  printJson({
    repo: `${owner}/${repo}`,
    pending_count: results.length,
    tasks: results,
  }, opts.pretty);
}

async function cmdDeliver(positional, opts) {
  const slug = positional[1];
  const issueNumber = positional[2];
  if (!slug) throw usageError('deliver requires <owner/repo> <issue-number>');
  if (!issueNumber) throw usageError('deliver requires <issue-number>');
  if (!opts.outputFile) throw usageError('deliver requires --output-file');

  const token = resolveToken(opts);
  const repoPath = resolve(opts.repoPath || '.');
  const keyPath = opts.key || join(repoPath, '.creamlon', 'private.key');
  const proofsPath = join(repoPath, 'trust', 'proofs.log');

  const { owner, repo, parsed } = await loadAgentContext(slug, opts.ref);
  const capIds = parsed.creamlon?.capabilities?.map((c) => c.id) || [];
  const paymentRequired = parsed.creamlon?.payment_required === true;

  const issue = await getIssue(owner, repo, issueNumber, token);
  const task = parseTaskYaml(issue.body || '');
  const errors = validateTaskYaml(task, {
    payment_required: paymentRequired,
    capability_ids: capIds,
  });
  if (isExpired(task)) errors.push('task expired');

  const processed = await loadProcessedIds(proofsPath);
  if (task.request_id && hasProcessed(processed, task.request_id)) {
    errors.push('duplicate request_id in proofs.log');
  }

  if (errors.length) fail(`cannot deliver: ${errors.join('; ')}`);

  const inputHash = resolveInputHash(task);
  const outputHash = await hashFile(opts.outputFile);

  const privateKey = await readPrivateKeyFile(keyPath);
  const fields = buildProofFields({
    requestId: task.request_id,
    capabilityId: task.capability_id,
    inputHash,
    outputHash,
    completedAt: opts.completedAt,
  });
  const proof = signProof(fields, privateKey);
  const proofLine = JSON.stringify(proof);

  if (opts.dryRun) {
    printJson({ ok: true, dry_run: true, proof }, opts.pretty);
    return;
  }

  const commentBody = `Creamlon delivery proof:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\``;
  await createIssueComment(owner, repo, issueNumber, commentBody, token);
  await mkdir(dirname(proofsPath), { recursive: true });
  await appendFile(proofsPath, `${proofLine}\n`, 'utf8');
  await closeIssue(owner, repo, issueNumber, token);

  printJson({
    ok: true,
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
    console.log(topic && HELP[topic] ? HELP[topic] : HELP.main);
    return;
  }

  const { positional, opts } = parseArgs([cmd, ...rest]);
  const command = positional[0];

  switch (command) {
    case 'keygen':
      await cmdKeygen(opts);
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
    case 'submit':
      await cmdSubmit(positional, opts);
      break;
    case 'watch':
      await cmdWatch(positional, opts);
      break;
    case 'deliver':
      await cmdDeliver(positional, opts);
      break;
    case 'init':
      await cmdInit(positional, opts);
      break;
    default:
      throw usageError(`unknown command: ${command}`);
  }
}
