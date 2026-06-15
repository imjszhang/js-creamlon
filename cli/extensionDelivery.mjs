import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { parseTask, resolveInputDigest } from '../lib/task.mjs';
import { parseProofJson, publicKeyFromBase64Url, verifyProof } from '../lib/proof.mjs';
import { parseRepoSlug } from '../lib/manifest.mjs';
import { getIssue, getIssueComments, getRepositoryFile } from '../lib/github.mjs';
import { extractBoundProofFromComments, verifyProofBinding } from '../lib/proofComment.mjs';
import { inspectKeyContinuity, publicKeyAt } from '../lib/identity.mjs';
import { generateDeliveryKeyPair } from '../lib/extensions/delivery/hpke.mjs';
import { prepareDelivery } from '../lib/extensions/delivery/prepare.mjs';
import { sendInput, fetchInput } from '../lib/extensions/delivery/input.mjs';
import { sendOutput, fetchOutput } from '../lib/extensions/delivery/output.mjs';
import {
  parseManifestDelivery,
  isSafeGithubArtifactPath,
  validateManifestDelivery,
  validateTaskDelivery,
} from '../lib/extensions/delivery/schema.mjs';
import {
  DEFAULT_INBOX_REGISTRY,
  findInbox,
  readInboxRegistry,
} from '../lib/inboxRegistry.mjs';

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

async function readDeliveryPrivateKey(path) {
  return (await readFile(path, 'utf8')).trim();
}

async function verifyDeliveryProof({
  slug,
  parsed,
  proof,
  task,
  token,
  ref,
}) {
  const inputDigest = resolveInputDigest(task);
  const binding = verifyProofBinding(proof, task, inputDigest, { manifest: parsed });
  if (!binding.ok) {
    fail(`proof binding failed: ${binding.errors.join('; ')}`);
  }
  const currentPublicKey = parsed.identity?.public_key;
  if (!currentPublicKey) fail('creamlon.yaml has no identity.public_key');
  const { owner, repo } = parseRepoSlug(slug);
  const rotationsText = await getRepositoryFile(
    owner,
    repo,
    'trust/key-rotations.log',
    ref || 'main',
    token,
    { optional: true },
  );
  const continuity = inspectKeyContinuity(rotationsText, currentPublicKey);
  if (continuity.status === 'broken') {
    fail(`invalid key rotation chain: ${continuity.errors.join('; ')}`);
  }
  const publicKeyB64 = publicKeyAt(continuity.history, proof.completed_at);
  if (!publicKeyB64) fail('no public key valid at proof completion time');
  const verify = verifyProof(proof, publicKeyFromBase64Url(publicKeyB64));
  if (!verify.ok) fail(verify.reason || 'proof signature verification failed');
  return {
    binding_ok: true,
    signature_ok: true,
    key_continuity: continuity.status,
  };
}

export async function cmdExtensionDeliveryKeygen(opts) {
  const outDir = resolve(opts.out || '.creamlon');
  await mkdir(outDir, { recursive: true });
  const keys = generateDeliveryKeyPair();
  await writeFile(join(outDir, 'delivery.public.b64url'), `${keys.public_key}\n`, { mode: 0o600 });
  const privateKeyPath = join(outDir, 'delivery.private.b64url');
  await writeFile(privateKeyPath, `${keys.private_key}\n`, { mode: 0o600 });
  await chmod(privateKeyPath, 0o600);
  return {
    ok: true,
    out: outDir,
    public_key: keys.public_key,
    next_steps: [
      `Add scheme: hpke-x25519-hkdf-sha256-aes256gcm-v2 and receive_public_key: ${keys.public_key} to creamlon.yaml extensions.delivery`,
      'For presigned transport, also add presigned_hosts with the exact storage hostnames',
      'Keep delivery.private.b64url local',
    ],
  };
}

export async function cmdExtensionDeliveryPrepare(positional, opts, { loadManifestContext, printJson }) {
  const slug = positional[3];
  if (!slug) throw usageError('extension delivery prepare requires <owner/repo>');
  const transport = opts.transport || 'github-private-repo';
  const { parsed } = await loadManifestContext(slug, opts.ref);
  const manifestDelivery = parseManifestDelivery(parsed);
  const manifestErrors = validateManifestDelivery(manifestDelivery);
  if (manifestErrors.length) fail(`invalid node delivery manifest: ${manifestErrors.join('; ')}`);
  if (!manifestDelivery?.receive_public_key) {
    fail('node manifest missing extensions.delivery.receive_public_key');
  }
  if (manifestDelivery?.transports && !manifestDelivery.transports.includes(transport)) {
    fail(`node does not advertise transport: ${transport}`);
  }

  const registryPath = opts.registry || DEFAULT_INBOX_REGISTRY;
  const registry = transport === 'github-private-repo'
    ? await readInboxRegistry(registryPath)
    : null;
  const registeredInbox = registry ? findInbox(registry, slug) : null;
  if (registeredInbox?.trust === 'blocked') {
    fail(`inbox trust level blocks delivery to ${slug}`, 4);
  }
  const manifestTemplates = manifestDelivery?.github?.inbox_path_template;
  const github = transport === 'github-private-repo'
    ? {
        repo: opts.githubRepo || registeredInbox?.repo,
        input_path: opts.githubInputPath
          || registeredInbox?.path_template?.input
          || manifestTemplates?.input
          || 'tasks/{request_id}/input.enc',
        output_path: opts.githubOutputPath
          || registeredInbox?.path_template?.output
          || manifestTemplates?.output
          || 'tasks/{request_id}/output.enc',
        ref: opts.githubRef || registeredInbox?.ref || 'main',
      }
    : null;
  if (transport === 'github-private-repo' && !github.repo) {
    throw usageError(
      `no inbox registered for ${slug}; run caller inbox init --node ${slug} `
        + 'or pass --github-repo',
    );
  }
  if (transport === 'github-private-repo') {
    for (const [field, value] of [
      ['input', github.input_path],
      ['output', github.output_path],
    ]) {
      if (!value.includes('{request_id}') || !isSafeGithubArtifactPath(value)) {
        throw usageError(`github ${field} path template must be a safe relative path containing {request_id}`);
      }
    }
  }
  if (transport === 'presigned-object-storage') {
    if (!opts.inputUploadUrl || !opts.outputUploadUrl || !opts.inputGetUrl || !opts.outputGetUrl) {
      throw usageError('presigned transport requires --input-upload-url, --input-get-url, --output-upload-url, --output-get-url');
    }
    if (!manifestDelivery.presigned_hosts?.length) {
      fail('node manifest requires extensions.delivery.presigned_hosts for presigned transport');
    }
    for (const value of [opts.inputUploadUrl, opts.outputUploadUrl]) {
      let url;
      try {
        url = new URL(value);
      } catch {
        fail('presigned upload URLs must be valid HTTPS URLs');
      }
      const allowedHosts = manifestDelivery.presigned_hosts
        .map((host) => String(host).toLowerCase());
      if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname.toLowerCase())) {
        fail(`presigned artifact host is not allowed: ${url.hostname}`);
      }
    }
  }

  const result = await prepareDelivery({
    transport,
    requestId: opts.requestId,
    inputUploadUrl: opts.inputUploadUrl,
    inputGetUrl: opts.inputGetUrl,
    outputUploadUrl: opts.outputUploadUrl,
    outputGetUrl: opts.outputGetUrl,
    github,
    outboxDir: opts.outboxDir || '.creamlon/outbox',
    scheme: manifestDelivery.scheme,
  });
  const extensionsPath = opts.extensionsOut
    || join(dirname(result.outbox_path), `${result.request_id}.extensions.json`);
  await writeFile(extensionsPath, `${JSON.stringify(result.extensions, null, 2)}\n`, 'utf8');
  printJson({
    ok: true,
    request_id: result.request_id,
    extensions: result.extensions,
    extensions_file: extensionsPath,
    outbox_path: result.outbox_path,
    node_receive_public_key: manifestDelivery?.receive_public_key || null,
    inbox_registry: registeredInbox ? registryPath : null,
  }, opts.pretty);
}

export async function cmdExtensionDeliverySendInput(opts, { resolveToken, printJson }) {
  if (!opts.taskFile) throw usageError('send-input requires --task-file');
  if (!opts.inputFile) throw usageError('send-input requires --input-file');
  const task = parseTask(await readFile(resolve(opts.taskFile), 'utf8'));
  const manifest = opts.manifestFile
    ? JSON.parse(await readFile(resolve(opts.manifestFile), 'utf8'))
    : { extensions: { delivery: { receive_public_key: opts.receivePublicKey } } };
  if (!manifest?.extensions?.delivery?.receive_public_key && !opts.receivePublicKey) {
    throw usageError('send-input requires --manifest-file or --receive-public-key');
  }
  if (opts.receivePublicKey) {
    manifest.extensions = manifest.extensions || {};
    manifest.extensions.delivery = manifest.extensions.delivery || {};
    manifest.extensions.delivery.receive_public_key = opts.receivePublicKey;
  }
  const result = await sendInput({
    task,
    manifest,
    inputFile: resolve(opts.inputFile),
    outboxPath: opts.outbox,
    token: resolveToken(opts),
  });
  printJson({ ok: true, request_id: task.request_id, ...result }, opts.pretty);
}

export async function cmdExtensionDeliveryFetchInput(positional, opts, { loadManifestContext, resolveToken, printJson }) {
  const slug = positional[3];
  const issueNumber = positional[4];
  if (!slug || !issueNumber) throw usageError('fetch-input requires <owner/repo> <issue-number>');
  if (!opts.outputFile) throw usageError('fetch-input requires --output-file');
  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
  const issue = await getIssue(owner, repo, issueNumber, token);
  const task = parseTask(issue.body || '');
  const deliveryErrors = validateTaskDelivery(task?.extensions?.delivery, {
    manifestDelivery: parseManifestDelivery(parsed),
  });
  if (deliveryErrors.length) fail(`invalid task delivery extension: ${deliveryErrors.join('; ')}`);
  const keyPath = resolve(opts.deliveryKey || join(opts.repoPath || '.', '.creamlon', 'delivery.private.b64url'));
  const nodePrivateKey = await readDeliveryPrivateKey(keyPath);
  const result = await fetchInput({
    task,
    outputFile: resolve(opts.outputFile),
    nodePrivateKey,
    inputGetUrl: opts.inputGetUrl,
    token,
  });
  printJson({ ok: true, request_id: task.request_id, issue_number: Number(issueNumber), ...result }, opts.pretty);
}

export async function cmdExtensionDeliverySendOutput(positional, opts, { loadManifestContext, resolveToken, printJson }) {
  const slug = positional[3];
  const issueNumber = positional[4];
  if (!slug || !issueNumber) throw usageError('send-output requires <owner/repo> <issue-number>');
  if (!opts.outputFile) throw usageError('send-output requires --output-file');
  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
  const issue = await getIssue(owner, repo, issueNumber, token);
  const task = parseTask(issue.body || '');
  const deliveryErrors = validateTaskDelivery(task?.extensions?.delivery, {
    manifestDelivery: parseManifestDelivery(parsed),
  });
  if (deliveryErrors.length) fail(`invalid task delivery extension: ${deliveryErrors.join('; ')}`);
  const result = await sendOutput({
    task,
    outputFile: resolve(opts.outputFile),
    token,
    allowedPresignedHosts: parseManifestDelivery(parsed)?.presigned_hosts || null,
  });
  printJson({ ok: true, request_id: task.request_id, issue_number: Number(issueNumber), ...result }, opts.pretty);
}

export async function cmdExtensionDeliveryFetchOutput(positional, opts, { loadManifestContext, resolveToken, printJson }) {
  const slug = positional[3];
  const issueNumber = positional[4];
  if (!slug || !issueNumber) throw usageError('fetch-output requires <owner/repo> <issue-number>');
  if (!opts.outbox) throw usageError('fetch-output requires --outbox');
  if (!opts.outputFile) throw usageError('fetch-output requires --output-file');
  const token = resolveToken(opts);
  const { owner, repo, parsed } = await loadManifestContext(slug, opts.ref);
  const issue = await getIssue(owner, repo, issueNumber, token);
  const task = parseTask(issue.body || '');
  let proof;
  let verifyResult = null;
  if (opts.proofFile) {
    proof = parseProofJson(await readFile(resolve(opts.proofFile), 'utf8'));
  } else {
    const comments = await getIssueComments(owner, repo, issueNumber, token);
    const extracted = extractBoundProofFromComments(
      comments,
      task,
      resolveInputDigest(task),
      { manifest: parsed },
    );
    if (!extracted.proof) fail('no valid proof found in issue comments');
    proof = extracted.proof;
  }
  if (!opts.noVerify) {
    verifyResult = await verifyDeliveryProof({
      slug,
      parsed,
      proof,
      task,
      token,
      ref: opts.ref,
    });
  }
  const result = await fetchOutput({
    task,
    proof,
    outboxFile: resolve(opts.outbox),
    outputFile: resolve(opts.outputFile),
    token,
  });
  printJson({
    ok: true,
    request_id: task.request_id,
    issue_number: Number(issueNumber),
    output_digest: proof.output_digest,
    ...(verifyResult || {}),
    ...result,
  }, opts.pretty);
}

export async function cmdExtension(positional, opts, ctx) {
  const topic = positional[1];
  const action = positional[2];
  if (topic !== 'delivery') throw usageError(`unknown extension topic: ${topic || '<missing>'}`);
  switch (action) {
    case 'keygen': {
      const { printJson } = ctx;
      printJson(await cmdExtensionDeliveryKeygen(opts), opts.pretty);
      break;
    }
    case 'prepare':
      await cmdExtensionDeliveryPrepare(positional, opts, ctx);
      break;
    case 'send-input':
      await cmdExtensionDeliverySendInput(opts, ctx);
      break;
    case 'fetch-input':
      await cmdExtensionDeliveryFetchInput(positional, opts, ctx);
      break;
    case 'send-output':
      await cmdExtensionDeliverySendOutput(positional, opts, ctx);
      break;
    case 'fetch-output':
      await cmdExtensionDeliveryFetchOutput(positional, opts, ctx);
      break;
    default:
      throw usageError(`unknown extension delivery command: ${action || '<missing>'}`);
  }
}

export const EXTENSION_DELIVERY_HELP = `creamlon extension delivery <command>

Commands:
  keygen [--out <dir>]                 Generate node X25519 delivery key pair
  prepare <owner/repo> [options]       Build task extensions and local outbox
  send-input [options]                 Encrypt and upload task input
  fetch-input <owner/repo> <issue#>    Decrypt task input on the node
  send-output <owner/repo> <issue#>    Encrypt and upload task output
  fetch-output <owner/repo> <issue#>   Decrypt output and verify proof digest

prepare options:
  --transport <id>                     Default: github-private-repo
                                        Alternative: presigned-object-storage
  --request-id <uuid>
  --registry <path>                    Default: .creamlon/caller/inboxes.yaml
  --outbox-dir <path>                  Default: .creamlon/outbox
  --extensions-out <path>
  --input-upload-url / --input-get-url
  --output-upload-url / --output-get-url
  --github-repo github:owner/repo
  --github-input-path <template>       Default: tasks/{request_id}/input.enc
  --github-output-path <template>      Default: tasks/{request_id}/output.enc
  --github-ref <branch>

send-input options:
  --task-file <path>                   Task YAML
  --input-file <path>
  --manifest-file <json>               Node manifest JSON or use --receive-public-key
  --receive-public-key <b64>
  --outbox <path>                      For github caller upload token in outbox
  --token <pat>                        Caller token; or GITHUB_TOKEN / GH_TOKEN

fetch-input options:
  --repo-path <dir>
  --delivery-key <path>                Default: <repo>/.creamlon/delivery.private.b64url
  --input-get-url <url>                Required for presigned transport
  --output-file <path>
  --token <pat>                        Node token; or GITHUB_TOKEN / GH_TOKEN

send-output options:
  --output-file <path>
  --token <pat>                        Node token; or GITHUB_TOKEN / GH_TOKEN

fetch-output options:
  --outbox <path>                      Required local outbox JSON
  --output-file <path>
  --proof-file <path>                  Optional; otherwise read from Issue
  --no-verify                          Skip Ed25519 proof verification (not recommended)
  --token <pat>                        Caller token; or GITHUB_TOKEN / GH_TOKEN`;
