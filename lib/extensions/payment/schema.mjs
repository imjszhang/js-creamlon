function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseProvider(provider) {
  const raw = object(provider);
  if (!raw) return null;
  return {
    ...raw,
    id: raw.id == null ? null : String(raw.id),
    capability_id: raw.capability_id == null ? null : String(raw.capability_id),
  };
}

export function parseManifestPayment(manifest) {
  const payment = object(manifest?.extensions?.payment);
  if (!payment) return null;
  return {
    ...payment,
    pattern: payment.pattern == null ? null : String(payment.pattern),
    instructions: payment.instructions == null ? null : String(payment.instructions),
    providers: Array.isArray(payment.providers)
      ? payment.providers.map(parseProvider).filter(Boolean)
      : [],
  };
}

export function resolvePaymentProviders(manifest, capabilityId) {
  const payment = parseManifestPayment(manifest);
  if (!payment) return [];
  const id = String(capabilityId);
  const exact = payment.providers.filter((provider) => provider.capability_id === id);
  if (exact.length) return exact;
  return payment.providers.filter((provider) => provider.capability_id == null);
}
