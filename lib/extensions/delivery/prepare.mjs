import { randomUUID } from 'node:crypto';
import { DELIVERY_SCHEME, generateDeliveryKeyPair } from './hpke.mjs';
import {
  TRANSPORT_GITHUB,
  TRANSPORT_PRESIGNED,
  resolveGithubPath,
} from './schema.mjs';
import { outboxPath, writeOutbox } from './outbox.mjs';

export function buildTaskDeliveryExtensions({
  transport,
  ephemeralPublicKey,
  requestId,
  inputUploadUrl = null,
  outputUploadUrl = null,
  github = null,
  scheme = DELIVERY_SCHEME,
}) {
  const delivery = {
    scheme,
    transport,
    ephemeral_public_key: ephemeralPublicKey,
  };
  if (transport === TRANSPORT_PRESIGNED) {
    delivery.artifacts = {
      input: { upload_url: inputUploadUrl },
      output: { upload_url: outputUploadUrl },
    };
  } else if (transport === TRANSPORT_GITHUB) {
    delivery.github = {
      repo: github.repo,
      input_path: resolveGithubPath(github.input_path, requestId),
      input_commit: null,
      output_path: resolveGithubPath(github.output_path, requestId),
      ref: github.ref || 'main',
    };
  }
  return { delivery };
}

export async function prepareDelivery({
  transport,
  requestId = randomUUID(),
  inputUploadUrl = null,
  inputGetUrl = null,
  outputUploadUrl = null,
  outputGetUrl = null,
  github = null,
  outboxDir = '.creamlon/runtime/outbox',
  scheme = DELIVERY_SCHEME,
}) {
  const keys = generateDeliveryKeyPair();
  const extensions = buildTaskDeliveryExtensions({
    transport,
    ephemeralPublicKey: keys.public_key,
    requestId,
    inputUploadUrl,
    outputUploadUrl,
    github,
    scheme,
  });
  const outbox = {
    version: '1',
    request_id: requestId,
    scheme,
    transport,
    ephemeral_private_key: keys.private_key,
    ephemeral_public_key: keys.public_key,
    ...(transport === TRANSPORT_PRESIGNED
      ? {
          artifacts: {
            input: { get_url: inputGetUrl },
            output: { get_url: outputGetUrl },
          },
        }
      : {}),
    ...(transport === TRANSPORT_GITHUB && github
      ? {
          github: {
            repo: github.repo,
            input_path: resolveGithubPath(github.input_path, requestId),
            input_commit: null,
            output_path: resolveGithubPath(github.output_path, requestId),
            ref: github.ref || 'main',
          },
        }
      : {}),
  };
  const path = outboxPath(outboxDir, requestId);
  await writeOutbox(path, outbox);
  return { request_id: requestId, extensions, outbox, outbox_path: path };
}
