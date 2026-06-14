import { DELIVERY_SCHEME } from './hpke.mjs';

export const TRANSPORT_PRESIGNED = 'presigned-object-storage';
export const TRANSPORT_GITHUB = 'github-private-repo';
export const TRANSPORTS = new Set([TRANSPORT_PRESIGNED, TRANSPORT_GITHUB]);
const GITHUB_REPO_RE = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const KEY_B64_RE = /^[A-Za-z0-9_-]{40,128}$/;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function parseManifestDelivery(manifest) {
  const delivery = object(manifest?.extensions?.delivery);
  if (!delivery) return null;
  return delivery;
}

export function validateManifestDelivery(delivery) {
  const errors = [];
  if (!delivery) return errors;
  if (delivery.scheme && delivery.scheme !== DELIVERY_SCHEME) {
    errors.push(`unsupported delivery scheme: ${delivery.scheme}`);
  }
  if (delivery.receive_public_key && !KEY_B64_RE.test(delivery.receive_public_key)) {
    errors.push('invalid delivery.receive_public_key');
  }
  if (delivery.transports) {
    if (!Array.isArray(delivery.transports)) {
      errors.push('delivery.transports must be an array');
    } else {
      for (const transport of delivery.transports) {
        if (!TRANSPORTS.has(transport)) errors.push(`unsupported delivery transport: ${transport}`);
      }
    }
  }
  return errors;
}

export function parseTaskDelivery(task) {
  const delivery = object(task?.extensions?.delivery);
  if (!delivery) return null;
  return delivery;
}

export function validateTaskDelivery(delivery, { manifestDelivery = null } = {}) {
  const errors = [];
  if (!delivery) return errors;
  if (delivery.scheme !== DELIVERY_SCHEME) {
    errors.push(`delivery.scheme must be ${DELIVERY_SCHEME}`);
  }
  if (!TRANSPORTS.has(delivery.transport)) {
    errors.push(`unsupported delivery.transport: ${delivery.transport || '<missing>'}`);
  }
  if (!delivery.ephemeral_public_key || !KEY_B64_RE.test(delivery.ephemeral_public_key)) {
    errors.push('invalid delivery.ephemeral_public_key');
  }
  if (manifestDelivery?.transports?.length
    && !manifestDelivery.transports.includes(delivery.transport)) {
    errors.push(`node does not advertise transport: ${delivery.transport}`);
  }
  if (delivery.transport === TRANSPORT_PRESIGNED) {
    const artifacts = object(delivery.artifacts);
    if (!artifacts?.input?.upload_url || !artifacts?.output?.upload_url) {
      errors.push('presigned delivery requires artifacts.input.upload_url and artifacts.output.upload_url');
    }
  }
  if (delivery.transport === TRANSPORT_GITHUB) {
    const github = object(delivery.github);
    if (!github?.repo || !GITHUB_REPO_RE.test(github.repo)) {
      errors.push('github delivery requires delivery.github.repo');
    }
    if (!github?.input_path || !github?.output_path) {
      errors.push('github delivery requires delivery.github.input_path and output_path');
    }
  }
  return errors;
}

export function resolveGithubPath(template, requestId) {
  return String(template).replaceAll('{request_id}', requestId);
}
