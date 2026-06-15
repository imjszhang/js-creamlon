import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashBuffer } from '../../hash.mjs';
import { resolveInputDigest } from '../../task.mjs';
import { seal, open } from './hpke.mjs';
import {
  parseManifestDelivery,
  parseTaskDelivery,
  TRANSPORT_GITHUB,
  TRANSPORT_PRESIGNED,
} from './schema.mjs';
import { readOutbox } from './outbox.mjs';
import { putBytes, getBytes } from './transport-presigned.mjs';
import { putArtifact, getArtifact } from './transport-github.mjs';

export async function sendInput({
  task,
  manifest,
  inputFile,
  outboxPath: outboxFile = null,
  token = null,
}) {
  const delivery = parseTaskDelivery(task);
  if (!delivery) throw new Error('task has no delivery extension');
  const nodeDelivery = parseManifestDelivery(manifest);
  if (!nodeDelivery?.receive_public_key) {
    throw new Error('node manifest missing extensions.delivery.receive_public_key');
  }
  const expectedDigest = resolveInputDigest(task);
  const plaintext = await readFile(inputFile);
  const actualDigest = hashBuffer(plaintext);
  if (actualDigest !== expectedDigest) {
    throw new Error('input file digest does not match task.input.digest');
  }
  const sealed = seal(plaintext, nodeDelivery.receive_public_key, delivery.scheme);
  const bytes = Buffer.from(sealed, 'utf8');

  if (delivery.transport === TRANSPORT_PRESIGNED) {
    await putBytes(delivery.artifacts.input.upload_url, bytes);
    return { ok: true, transport: delivery.transport, bytes: bytes.length };
  }
  if (delivery.transport === TRANSPORT_GITHUB) {
    const auth = token || (outboxFile ? (await readOutbox(outboxFile)).github_token : null);
    if (!auth) throw new Error('github transport requires --token or outbox github_token');
    const uploaded = await putArtifact({
      repo: delivery.github.repo,
      path: delivery.github.input_path,
      bytes,
      token: auth,
      ref: delivery.github.ref || 'main',
      message: `creamlon: input ${task.request_id}`,
    });
    return {
      ok: true,
      transport: delivery.transport,
      bytes: bytes.length,
      input_commit: uploaded.commit_sha,
    };
  }
  throw new Error(`unsupported delivery transport: ${delivery.transport}`);
}

export async function fetchInput({
  task,
  outputFile,
  nodePrivateKey,
  inputGetUrl = null,
  token = null,
}) {
  const delivery = parseTaskDelivery(task);
  if (!delivery) throw new Error('task has no delivery extension');
  if (!nodePrivateKey) throw new Error('node delivery private key required');

  let sealedBytes;
  if (delivery.transport === TRANSPORT_PRESIGNED) {
    if (!inputGetUrl) throw new Error('presigned transport requires --input-get-url');
    sealedBytes = await getBytes(inputGetUrl);
  } else if (delivery.transport === TRANSPORT_GITHUB) {
    if (!token) throw new Error('GITHUB_TOKEN required for github transport input fetch');
    sealedBytes = await getArtifact({
      repo: delivery.github.repo,
      path: delivery.github.input_path,
      ref: delivery.github.input_commit,
      token,
    });
  } else {
    throw new Error(`unsupported delivery transport: ${delivery.transport}`);
  }

  const plaintext = open(sealedBytes.toString('utf8'), nodePrivateKey);
  const expectedDigest = resolveInputDigest(task);
  const actualDigest = hashBuffer(plaintext);
  if (actualDigest !== expectedDigest) {
    throw new Error('decrypted input digest does not match task.input.digest');
  }
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, plaintext);
  return { ok: true, input_digest: actualDigest, output_file: outputFile };
}
