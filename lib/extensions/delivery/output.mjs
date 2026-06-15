import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashFile, hashBuffer } from '../../hash.mjs';
import { seal, open } from './hpke.mjs';
import { parseTaskDelivery, TRANSPORT_GITHUB, TRANSPORT_PRESIGNED } from './schema.mjs';
import { assertOutboxMatchesTask, readOutbox } from './outbox.mjs';
import { putBytes, getBytes } from './transport-presigned.mjs';
import { putArtifact, getArtifact } from './transport-github.mjs';

export async function sendOutput({
  task,
  outputFile,
  token = null,
  allowedPresignedHosts = null,
}) {
  const delivery = parseTaskDelivery(task);
  if (!delivery) throw new Error('task has no delivery extension');
  const plaintext = await readFile(outputFile);
  const outputDigest = hashBuffer(plaintext);
  const sealed = seal(plaintext, delivery.ephemeral_public_key, delivery.scheme);
  const bytes = Buffer.from(sealed, 'utf8');

  if (delivery.transport === TRANSPORT_PRESIGNED) {
    const outputUrl = new URL(delivery.artifacts.output.upload_url);
    const allowedHosts = allowedPresignedHosts?.map((host) => String(host).toLowerCase());
    if (!allowedHosts?.includes(outputUrl.hostname.toLowerCase())) {
      throw new Error(`presigned artifact host is not allowed: ${outputUrl.hostname}`);
    }
    await putBytes(delivery.artifacts.output.upload_url, bytes);
    return {
      ok: true,
      transport: delivery.transport,
      bytes: bytes.length,
      output_digest: outputDigest,
    };
  }
  if (delivery.transport === TRANSPORT_GITHUB) {
    if (!token) throw new Error('GITHUB_TOKEN required for github transport output upload');
    await putArtifact({
      repo: delivery.github.repo,
      path: delivery.github.output_path,
      bytes,
      token,
      ref: delivery.github.ref || 'main',
      message: `creamlon: output ${task.request_id}`,
    });
    return {
      ok: true,
      transport: delivery.transport,
      bytes: bytes.length,
      output_digest: outputDigest,
    };
  }
  throw new Error(`unsupported delivery transport: ${delivery.transport}`);
}

export async function fetchOutput({
  task,
  proof,
  outboxFile,
  outputFile,
  token = null,
}) {
  const delivery = parseTaskDelivery(task);
  if (!delivery) throw new Error('task has no delivery extension');
  if (!proof?.output_digest) throw new Error('proof missing output_digest');
  const outbox = await readOutbox(outboxFile);
  assertOutboxMatchesTask(outbox, task);

  let sealedBytes;
  if (delivery.transport === TRANSPORT_PRESIGNED) {
    const getUrl = outbox.artifacts?.output?.get_url;
    if (!getUrl) throw new Error('outbox missing artifacts.output.get_url');
    sealedBytes = await getBytes(getUrl);
  } else if (delivery.transport === TRANSPORT_GITHUB) {
    const github = outbox.github || delivery.github;
    sealedBytes = await getArtifact({
      repo: github.repo,
      path: github.output_path,
      ref: github.ref || 'main',
      token: outbox.github_token || token,
    });
  } else {
    throw new Error(`unsupported delivery transport: ${delivery.transport}`);
  }

  const plaintext = open(sealedBytes.toString('utf8'), outbox.ephemeral_private_key);
  const actualDigest = hashBuffer(plaintext);
  if (actualDigest !== proof.output_digest) {
    throw new Error('decrypted output digest does not match proof.output_digest');
  }
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, plaintext);
  return { ok: true, output_digest: actualDigest, output_file: outputFile };
}

export async function verifyOutputFile(outputFile, proof) {
  const actualDigest = await hashFile(outputFile);
  if (actualDigest !== proof.output_digest) {
    throw new Error('output file digest does not match proof.output_digest');
  }
  return { ok: true, output_digest: actualDigest };
}
