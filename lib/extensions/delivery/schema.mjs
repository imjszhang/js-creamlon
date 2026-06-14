import { DELIVERY_SCHEME, DELIVERY_SCHEMES } from './hpke.mjs';

export const TRANSPORT_PRESIGNED = 'presigned-object-storage';
export const TRANSPORT_GITHUB = 'github-private-repo';
export const TRANSPORTS = new Set([TRANSPORT_PRESIGNED, TRANSPORT_GITHUB]);
const GITHUB_REPO_RE = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const KEY_B64_RE = /^[A-Za-z0-9_-]{40,128}$/;
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

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
  if (delivery.scheme && !DELIVERY_SCHEMES.has(delivery.scheme)) {
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
  if (delivery.presigned_hosts) {
    if (!Array.isArray(delivery.presigned_hosts) || delivery.presigned_hosts.length === 0) {
      errors.push('delivery.presigned_hosts must be a non-empty array');
    } else {
      for (const host of delivery.presigned_hosts) {
        if (!HOST_RE.test(String(host))) errors.push(`invalid delivery presigned host: ${host}`);
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
  if (!DELIVERY_SCHEMES.has(delivery.scheme)) {
    errors.push(`unsupported delivery.scheme: ${delivery.scheme || '<missing>'}`);
  }
  if (manifestDelivery?.scheme && delivery.scheme !== manifestDelivery.scheme) {
    errors.push(`node does not advertise delivery scheme: ${delivery.scheme}`);
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
    if (manifestDelivery && !manifestDelivery.presigned_hosts?.length) {
      errors.push('node manifest requires delivery.presigned_hosts for presigned transport');
    }
    for (const urlValue of [
      artifacts?.input?.upload_url,
      artifacts?.output?.upload_url,
    ]) {
      if (!urlValue) continue;
      try {
        const url = new URL(urlValue);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
        const allowedHosts = manifestDelivery?.presigned_hosts
          ?.map((host) => String(host).toLowerCase());
        if (allowedHosts?.length && !allowedHosts.includes(url.hostname.toLowerCase())) {
          errors.push(`presigned artifact host is not allowed: ${url.hostname}`);
        }
      } catch {
        errors.push('presigned artifact URLs must be credential-free HTTPS URLs');
      }
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
