import { DELIVERY_SCHEME, DELIVERY_SCHEMES } from './hpke.mjs';
import { hashText } from '../../hash.mjs';

export const TRANSPORT_PRESIGNED = 'presigned-object-storage';
export const TRANSPORT_GITHUB = 'github-private-repo';
export const TRANSPORTS = new Set([TRANSPORT_PRESIGNED, TRANSPORT_GITHUB]);
const GITHUB_REPO_RE = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const KEY_B64_RE = /^[A-Za-z0-9_-]{40,128}$/;
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function validateGithubPathTemplate(value, field, errors) {
  if (typeof value !== 'string' || !value.includes('{request_id}')) {
    errors.push(`delivery.github.inbox_path_template.${field} must contain {request_id}`);
  } else if (!isSafeGithubArtifactPath(value)) {
    errors.push(`delivery.github.inbox_path_template.${field} must be a relative path`);
  }
}

export function isSafeGithubArtifactPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/')) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;
  return !value.split('/').some((segment) => segment === '.' || segment === '..' || !segment);
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
  if (delivery.github) {
    const github = object(delivery.github);
    const templates = object(github?.inbox_path_template);
    if (!github || !templates) {
      errors.push('delivery.github.inbox_path_template must be a mapping');
    } else {
      validateGithubPathTemplate(templates.input, 'input', errors);
      validateGithubPathTemplate(templates.output, 'output', errors);
    }
  }
  return errors;
}

export function parseTaskDelivery(task) {
  const delivery = object(task?.extensions?.delivery);
  if (!delivery) return null;
  return delivery;
}

export function validateTaskDelivery(delivery, {
  manifestDelivery = null,
  requestId = null,
} = {}) {
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
    } else {
      if (!isSafeGithubArtifactPath(github.input_path)) {
        errors.push('delivery.github.input_path must be a safe relative path');
      }
      if (!isSafeGithubArtifactPath(github.output_path)) {
        errors.push('delivery.github.output_path must be a safe relative path');
      }
    }
    if (!GIT_OBJECT_ID_RE.test(github?.input_commit || '')) {
      errors.push('github delivery requires a valid delivery.github.input_commit');
    }
    if (requestId && (
      !github?.input_path?.includes(requestId)
      || !github?.output_path?.includes(requestId)
    )) {
      errors.push('github delivery artifact paths must contain task request_id');
    }
  }
  return errors;
}

export function resolveGithubPath(template, requestId) {
  return String(template).replaceAll('{request_id}', requestId);
}

export function canonicalDeliveryIntent(task) {
  const delivery = parseTaskDelivery(task);
  if (!delivery) return null;
  const value = {
    scheme: delivery.scheme,
    transport: delivery.transport,
    ephemeral_public_key: delivery.ephemeral_public_key,
  };
  if (delivery.transport === TRANSPORT_GITHUB) {
    value.github = {
      repo: delivery.github?.repo,
      ref: delivery.github?.ref || 'main',
      input_path: delivery.github?.input_path,
      input_commit: delivery.github?.input_commit,
      output_path: delivery.github?.output_path,
    };
  } else if (delivery.transport === TRANSPORT_PRESIGNED) {
    value.artifacts = {
      input: { upload_url: delivery.artifacts?.input?.upload_url },
      output: { upload_url: delivery.artifacts?.output?.upload_url },
    };
  }
  return JSON.stringify(value);
}

export function deliveryIntentDigest(task) {
  const canonical = canonicalDeliveryIntent(task);
  return canonical ? hashText(canonical) : null;
}
