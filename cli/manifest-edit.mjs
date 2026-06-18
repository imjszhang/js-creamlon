import { isMap, isSeq } from 'yaml';
import { parseManifestPayment } from '../lib/extensions/payment/schema.mjs';
import {
  deleteEmptyPayment,
  ensureMap,
  ensureNestedMap,
  ensureNestedSeq,
  getSeq,
  manifestFromDocument,
  readManifestDocument,
  updateManifestDocument,
} from '../lib/manifestWrite.mjs';

const STATUS_VALUES = new Set(['available', 'busy', 'offline']);
const PROVIDER_FIELDS = new Map([
  ['resourceUrl', 'resource_url'],
  ['price', 'price'],
  ['network', 'network'],
  ['asset', 'asset'],
  ['payTo', 'pay_to'],
  ['facilitator', 'facilitator'],
  ['checkoutUrl', 'checkout_url'],
]);

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 1;
  return error;
}

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function splitMediaTypes(value, optionName) {
  if (!value) throw usageError(`${optionName} requires at least one media type`);
  const items = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw usageError(`${optionName} requires at least one media type`);
  return items;
}

function capabilityId(item) {
  return isMap(item) ? item.get('id') : null;
}

function findCapabilitySeq(doc) {
  const seq = getSeq(doc, 'capabilities');
  if (!seq) fail('creamlon.yaml capabilities must be a sequence');
  return seq;
}

function assertCapabilityExists(doc, id) {
  const seq = findCapabilitySeq(doc);
  if (!seq.items.some((item) => capabilityId(item) === id)) {
    fail(`unknown capability id: ${id}`, 4);
  }
}

function ensureCredentialProfile(doc) {
  const profiles = ensureMap(doc, 'profiles');
  if (!profiles.get('credential', true)) {
    profiles.set('credential', doc.createNode({ scheme: 'voucher-hmac-v1' }));
  }
}

function commandResult(ok, result) {
  return { ok, ...result };
}

async function listCapabilities(opts, ctx) {
  const { doc, path } = await readManifestDocument(opts.repoPath || '.');
  const manifest = manifestFromDocument(doc);
  ctx.printJson({
    path,
    capabilities: manifest.capabilities,
  }, opts.pretty);
}

async function addCapability(opts, ctx) {
  if (!opts.id) throw usageError('capability add requires --id');
  if (!opts.description) throw usageError('capability add requires --description');
  if (!opts.inputType) throw usageError('capability add requires --input-type');
  if (!opts.outputType) throw usageError('capability add requires --output-type');
  if (opts.access && !['free', 'credential'].includes(opts.access)) {
    throw usageError('capability add --access must be free or credential');
  }
  const units = opts.units == null ? 1 : Number(opts.units);
  if (opts.access && units !== 1) throw usageError('capability add --units must be 1');

  const result = await updateManifestDocument(opts.repoPath || '.', async (doc) => {
    const capabilities = findCapabilitySeq(doc);
    if (capabilities.items.some((item) => capabilityId(item) === opts.id)) {
      fail(`capability already exists: ${opts.id}`, 4);
    }
    const capability = {
      id: opts.id,
      description: opts.description,
      input: { media_types: splitMediaTypes(opts.inputType, '--input-type') },
      output: { media_types: splitMediaTypes(opts.outputType, '--output-type') },
    };
    if (opts.access) {
      capability.access = { mode: opts.access, units };
      if (opts.access === 'credential') ensureCredentialProfile(doc);
    }
    capabilities.add(doc.createNode(capability));
    return { capability };
  });

  ctx.printJson(commandResult(true, {
    path: result.path,
    capability: result.capability,
  }), opts.pretty);
}

async function removeCapability(opts, ctx) {
  if (!opts.id) throw usageError('capability remove requires --id');
  const result = await updateManifestDocument(opts.repoPath || '.', async (doc) => {
    const capabilities = findCapabilitySeq(doc);
    const index = capabilities.items.findIndex((item) => capabilityId(item) === opts.id);
    if (index < 0) fail(`unknown capability id: ${opts.id}`, 4);
    if (capabilities.items.length === 1) {
      fail('cannot remove the last capability from creamlon.yaml', 4);
    }
    capabilities.items.splice(index, 1);

    const providers = doc.getIn(['extensions', 'payment', 'providers'], true);
    let removedPaymentProviders = 0;
    if (isSeq(providers)) {
      const before = providers.items.length;
      providers.items = providers.items.filter(
        (item) => !(isMap(item) && item.get('capability_id') === opts.id),
      );
      removedPaymentProviders = before - providers.items.length;
      deleteEmptyPayment(doc);
    }
    return { removed: opts.id, removedPaymentProviders };
  });

  ctx.printJson(commandResult(true, {
    path: result.path,
    removed: result.removed,
    removed_payment_providers: result.removedPaymentProviders,
  }), opts.pretty);
}

export async function cmdCapability(positional, opts, ctx) {
  const action = positional[1];
  if (action === 'list') return listCapabilities(opts, ctx);
  if (action === 'add') return addCapability(opts, ctx);
  if (action === 'remove') return removeCapability(opts, ctx);
  throw usageError('capability requires add, remove, or list');
}

async function listPayment(opts, ctx) {
  const { doc, path } = await readManifestDocument(opts.repoPath || '.');
  const payment = parseManifestPayment(manifestFromDocument(doc));
  ctx.printJson({
    path,
    payment,
    providers: payment?.providers || [],
  }, opts.pretty);
}

function providerFromOptions(opts) {
  if (!opts.capabilityId) throw usageError('payment set-provider requires --capability-id');
  if (!opts.providerId) throw usageError('payment set-provider requires --provider-id');
  const provider = {
    id: opts.providerId,
    capability_id: opts.capabilityId,
  };
  for (const [optionName, fieldName] of PROVIDER_FIELDS) {
    if (opts[optionName] != null) provider[fieldName] = opts[optionName];
  }
  return provider;
}

async function setPaymentProvider(opts, ctx) {
  const provider = providerFromOptions(opts);
  const result = await updateManifestDocument(opts.repoPath || '.', async (doc) => {
    assertCapabilityExists(doc, opts.capabilityId);
    const payment = ensureNestedMap(doc, ['extensions', 'payment']);
    payment.set('pattern', 'payment-bridge-v1');
    if (opts.instructions != null) payment.set('instructions', opts.instructions);
    const providers = ensureNestedSeq(doc, ['extensions', 'payment', 'providers']);
    const index = providers.items.findIndex((item) => (
      isMap(item)
        && item.get('id') === provider.id
        && item.get('capability_id') === provider.capability_id
    ));
    const node = doc.createNode(provider);
    if (index >= 0) providers.items[index] = node;
    else providers.add(node);
    return { provider, updated: index >= 0 };
  });

  ctx.printJson(commandResult(true, {
    path: result.path,
    updated: result.updated,
    provider: result.provider,
  }), opts.pretty);
}

async function removePaymentProvider(opts, ctx) {
  if (!opts.capabilityId) throw usageError('payment remove-provider requires --capability-id');
  if (!opts.providerId) throw usageError('payment remove-provider requires --provider-id');
  const result = await updateManifestDocument(opts.repoPath || '.', async (doc) => {
    const providers = doc.getIn(['extensions', 'payment', 'providers'], true);
    if (!isSeq(providers)) fail('no payment providers configured', 4);
    const before = providers.items.length;
    providers.items = providers.items.filter((item) => !(
      isMap(item)
        && item.get('id') === opts.providerId
        && item.get('capability_id') === opts.capabilityId
    ));
    if (providers.items.length === before) {
      fail(`payment provider not found: ${opts.providerId} for ${opts.capabilityId}`, 4);
    }
    deleteEmptyPayment(doc);
    return { removed: before - providers.items.length };
  });

  ctx.printJson(commandResult(true, {
    path: result.path,
    removed: result.removed,
  }), opts.pretty);
}

export async function cmdPayment(positional, opts, ctx) {
  const action = positional[1];
  if (action === 'list') return listPayment(opts, ctx);
  if (action === 'set-provider') return setPaymentProvider(opts, ctx);
  if (action === 'remove-provider') return removePaymentProvider(opts, ctx);
  throw usageError('payment requires set-provider, remove-provider, or list');
}

async function setNodeStatus(positional, opts, ctx) {
  const status = positional[2];
  if (!status) throw usageError('node set-status requires <status>');
  if (!STATUS_VALUES.has(status)) {
    throw usageError('node set-status requires available, busy, or offline');
  }
  const result = await updateManifestDocument(opts.repoPath || '.', async (doc) => {
    doc.set('status', status);
    return { status };
  });
  ctx.printJson(commandResult(true, {
    path: result.path,
    status: result.status,
  }), opts.pretty);
}

export async function cmdNode(positional, opts, ctx) {
  const action = positional[1];
  if (action === 'set-status') return setNodeStatus(positional, opts, ctx);
  throw usageError('node requires set-status');
}
