import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const config = {
  port: numberEnv('PORT', 4020),
  publicBaseUrl: stringEnv('PUBLIC_BASE_URL', 'http://localhost:4020'),
  facilitatorUrl: requiredEnv('X402_FACILITATOR_URL'),
  payTo: requiredEnv('X402_PAY_TO'),
  asset: stringEnv('X402_ASSET', 'USDC'),
  assetAddress: process.env.X402_ASSET_ADDRESS || null,
  network: stringEnv('X402_NETWORK', 'base'),
  scheme: stringEnv('X402_SCHEME', 'exact'),
  price: stringEnv('X402_PRICE', '0.50'),
  amount: requiredEnv('X402_AMOUNT'),
  maxTimeoutSeconds: numberEnv('X402_MAX_TIMEOUT_SECONDS', 300),
  credentialTtlSeconds: numberEnv('CREAMLON_CREDENTIAL_TTL_SECONDS', 3600),
  creamlonBin: stringEnv('CREAMLON_BIN', 'creamlon'),
  creamlonRepoPath: requiredEnv('CREAMLON_REPO_PATH'),
  idempotencyStore: stringEnv('IDEMPOTENCY_STORE', '.data/payments.json'),
  idempotencyLockTimeoutMs: numberEnv('IDEMPOTENCY_LOCK_TIMEOUT_MS', 10000),
};

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error(error.message);
    sendJson(response, 500, { error: 'internal_server_error' });
  }
});

server.listen(config.port, () => {
  console.log(`x402 credential vendor listening on http://localhost:${config.port}`);
});

async function handleRequest(request, response) {
  const url = new URL(request.url, config.publicBaseUrl);
  const match = url.pathname.match(/^\/buy\/([A-Za-z0-9_.-]+)$/);
  if (request.method !== 'GET' || !match) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  const capabilityId = match[1];
  const resource = buildResourceInfo(capabilityId, url);
  const paymentRequirements = buildPaymentRequirements(capabilityId, url);
  const paymentSignature = headerValue(request, 'payment-signature');

  if (!paymentSignature) {
    sendPaymentRequired(response, resource, paymentRequirements);
    return;
  }

  const paymentPayload = parsePaymentPayload(paymentSignature);
  if (!paymentPayload) {
    sendJson(response, 400, { error: 'invalid_payment_payload' });
    return;
  }

  await withIdempotencyLock(async () => {
    const paymentKey = digest(`${capabilityId}\n${paymentSignature}`);
    const store = await loadIdempotencyStore(config.idempotencyStore);
    const existing = store[paymentKey];
    if (existing?.credential) {
      sendCredential(response, existing);
      return;
    }

    const verifyResult = await callFacilitator('/verify', paymentPayload, paymentRequirements);
    if (!facilitatorAccepted(verifyResult)) {
      sendPaymentRequired(response, resource, paymentRequirements, 'payment_verification_failed');
      return;
    }

    const settleResult = await callFacilitator('/settle', paymentPayload, paymentRequirements);
    if (!facilitatorAccepted(settleResult)) {
      sendPaymentRequired(response, resource, paymentRequirements, 'payment_settlement_failed');
      return;
    }

    const credentialRecord = await createCredential(capabilityId);
    const receipt = {
      capability_id: capabilityId,
      credential: credentialRecord.credential,
      credential_id: credentialRecord.credential_id,
      expires: credentialRecord.expires,
      payment: safePaymentReceipt(settleResult),
      issued_at: new Date().toISOString(),
    };
    store[paymentKey] = receipt;
    await saveIdempotencyStore(config.idempotencyStore, store);
    sendCredential(response, receipt, settleResult);
  });
}

function buildResourceInfo(capabilityId, url) {
  return {
    url: `${config.publicBaseUrl}${url.pathname}`,
    description: `Creamlon credential for ${capabilityId}`,
    mimeType: 'application/json',
  };
}

function buildPaymentRequirements(capabilityId, url) {
  return {
    scheme: config.scheme,
    network: config.network,
    amount: config.amount,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    asset: config.assetAddress || config.asset,
    extra: {
      creamlon: {
        pattern: 'payment-bridge-v1',
        provider: 'x402',
        capability_id: capabilityId,
        price: config.price,
      },
    },
  };
}

function sendPaymentRequired(response, resource, paymentRequirements, error = null) {
  const body = {
    x402Version: 2,
    error,
    resource,
    accepts: [paymentRequirements],
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  sendJson(response, 402, body, {
    'PAYMENT-REQUIRED': encoded,
    'Cache-Control': 'no-store',
  });
}

function sendCredential(response, receipt, settleResult = null) {
  const headers = { 'Cache-Control': 'no-store' };
  if (settleResult) {
    headers['PAYMENT-RESPONSE'] = Buffer.from(JSON.stringify(safePaymentReceipt(settleResult)), 'utf8')
      .toString('base64url');
  }
  sendJson(response, 200, {
    credential: receipt.credential,
    credential_id: receipt.credential_id,
    capability_id: receipt.capability_id,
    expires: receipt.expires,
    payment: receipt.payment,
    warning: 'Keep the complete credential secret. Do not paste it into public Issues or logs.',
  }, headers);
}

async function callFacilitator(pathname, paymentPayload, paymentRequirements) {
  const endpoint = new URL(pathname, config.facilitatorUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    }),
  });
  const text = await response.text();
  let body = {};
  if (text) {
    body = JSON.parse(text);
  }
  return { ok: response.ok, status: response.status, ...body };
}

function facilitatorAccepted(result) {
  return result.ok && (result.valid === true || result.isValid === true || result.success === true);
}

function parsePaymentPayload(paymentSignature) {
  try {
    const normalized = paymentSignature.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function headerValue(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function createCredential(capabilityId) {
  const expires = new Date(Date.now() + config.credentialTtlSeconds * 1000).toISOString();
  const { stdout } = await execFileAsync(config.creamlonBin, [
    'credential',
    'create',
    '--repo-path',
    config.creamlonRepoPath,
    '--capability-id',
    capabilityId,
    '--expires',
    expires,
  ], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function loadIdempotencyStore(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveIdempotencyStore(path, store) {
  const absolutePath = resolve(path);
  const tempPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, absolutePath);
}

async function withIdempotencyLock(callback) {
  const release = await acquireLocalLock(`${resolve(config.idempotencyStore)}.lock`, {
    timeoutMs: config.idempotencyLockTimeoutMs,
  });
  try {
    await callback();
  } finally {
    await release();
  }
}

async function acquireLocalLock(path, { timeoutMs, retryMs = 25 }) {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
      })}\n`);
      return async () => {
        await handle.close();
        await rm(path, { force: true });
      };
    } catch (error) {
      if (!isLockConflict(error)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`idempotency store is busy: ${config.idempotencyStore}`);
      }
      await sleep(retryMs);
    }
  }
}

function isLockConflict(error) {
  return error.code === 'EEXIST' || (process.platform === 'win32' && error.code === 'EPERM');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safePaymentReceipt(settleResult) {
  const { transaction, transactionHash, txHash, network, payer, scheme, status } = settleResult;
  return {
    status: status || 'settled',
    network,
    scheme,
    payer,
    transaction_hash: transactionHash || txHash || (typeof transaction === 'string' ? transaction : transaction?.hash) || null,
  };
}

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function stringEnv(name, fallback) {
  return process.env[name] || fallback;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}
