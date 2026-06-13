import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'template', 'agent-node');

const HELP = {
  main: `Creamlon - Creamlon protocol CLI v0.1

Usage:
  creamlon <command> [options]

Commands:
  keygen [--out <dir>]              Generate Ed25519 key pair
  hash <text>                       Hash text as sha256:...
  hash --file <path>                Hash file contents
  sign [options]                    Sign and output proof JSON
  verify [options]                  Verify proof signature
  inspect <owner/repo>              Fetch and show agent.yaml
  init <dir> [--name <name>]        Scaffold agent node from template
  help [command]                    Show help

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
  init: `creamlon init <dir> [--name <name>]

Copy template/agent-node/ to <dir> and replace {{name}} placeholders.`,
};

function parseArgs(argv) {
  const positional = [];
  const opts = { pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pretty') opts.pretty = true;
    else if (arg === '--out') { i += 1; opts.out = argv[i]; }
    else if (arg === '--file') { i += 1; opts.file = argv[i]; }
    else if (arg === '--request-id') { i += 1; opts.requestId = argv[i]; }
    else if (arg === '--capability-id') { i += 1; opts.capabilityId = argv[i]; }
    else if (arg === '--input-hash') { i += 1; opts.inputHash = argv[i]; }
    else if (arg === '--output-hash') { i += 1; opts.outputHash = argv[i]; }
    else if (arg === '--key') { i += 1; opts.key = argv[i]; }
    else if (arg === '--completed-at') { i += 1; opts.completedAt = argv[i]; }
    else if (arg === '--repo') { i += 1; opts.repo = argv[i]; }
    else if (arg === '--public-key') { i += 1; opts.publicKey = argv[i]; }
    else if (arg === '--proof') { i += 1; opts.proof = argv[i]; }
    else if (arg === '--name') { i += 1; opts.name = argv[i]; }
    else if (arg === '--ref') { i += 1; opts.ref = argv[i]; }
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
      await writeFileRecursive(destPath, content);
    }
  }
}

async function writeFileRecursive(path, content) {
  await writeFile(path, content, 'utf8');
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
    case 'init':
      await cmdInit(positional, opts);
      break;
    default:
      throw usageError(`unknown command: ${command}`);
  }
}
