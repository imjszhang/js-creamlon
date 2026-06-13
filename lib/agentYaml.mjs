export function parseAgentYaml(text) {
  const result = { name: null, description: null, creamlon: null };

  for (const line of text.split('\n')) {
    if (line.startsWith('name:')) result.name = unquote(line.slice(5).trim());
    if (line.startsWith('description:')) result.description = unquote(line.slice(12).trim());
  }

  const creamlonIdx = text.indexOf('creamlon:');
  if (creamlonIdx !== -1) {
    result.creamlon = parseCreamlonBlock(text.slice(creamlonIdx + 'creamlon:'.length));
  }

  return result;
}

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

function parseScalarBool(s) {
  const v = unquote(s.trim());
  return v === 'true';
}

function parseCreamlonBlock(block) {
  const creamlon = {
    version: null,
    public_key: null,
    capabilities: [],
    payment_required: false,
    payment_instructions: null,
  };
  const lines = block.split('\n');
  let inCapabilities = false;
  let currentCap = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('version:')) {
      creamlon.version = unquote(trimmed.slice(8).trim());
      inCapabilities = false;
      continue;
    }
    if (trimmed.startsWith('public_key:')) {
      creamlon.public_key = unquote(trimmed.slice(11).trim());
      inCapabilities = false;
      continue;
    }
    if (trimmed.startsWith('payment_required:')) {
      creamlon.payment_required = parseScalarBool(trimmed.slice(17).trim());
      inCapabilities = false;
      continue;
    }
    if (trimmed.startsWith('payment_instructions:')) {
      creamlon.payment_instructions = unquote(trimmed.slice(21).trim());
      inCapabilities = false;
      continue;
    }
    if (trimmed === 'capabilities:') {
      inCapabilities = true;
      continue;
    }
    if (inCapabilities && trimmed.startsWith('- id:')) {
      if (currentCap) creamlon.capabilities.push(currentCap);
      currentCap = { id: unquote(trimmed.slice(5).trim()), description: null };
      continue;
    }
    if (inCapabilities && currentCap && trimmed.startsWith('description:')) {
      currentCap.description = unquote(trimmed.slice(12).trim());
    }
  }
  if (currentCap) creamlon.capabilities.push(currentCap);
  return creamlon;
}

export function validateAgentYaml(parsed) {
  const errors = [];
  if (!parsed.name) errors.push('missing name');
  if (!parsed.creamlon) errors.push('missing creamlon block');
  else {
    if (!parsed.creamlon.version) errors.push('missing creamlon.version');
    if (!parsed.creamlon.public_key) errors.push('missing creamlon.public_key');
    if (!parsed.creamlon.capabilities?.length) errors.push('missing creamlon.capabilities');
    if (parsed.creamlon.payment_required && !parsed.creamlon.payment_instructions) {
      errors.push('payment_required is true but payment_instructions is missing');
    }
  }
  return errors;
}

let transportFetch = globalThis.fetch;

export function setAgentFetch(fn) {
  transportFetch = fn;
}

export async function fetchAgentYaml(owner, repo, ref = 'main') {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/agent.yaml`;
  const res = await transportFetch(url);
  if (!res.ok) {
    const hint = res.status === 404
      ? ' (try --ref master if the default branch is not main)'
      : '';
    throw new Error(`failed to fetch agent.yaml (${res.status}): ${url}${hint}`);
  }
  const text = await res.text();
  return { text, parsed: parseAgentYaml(text), url };
}

export function parseRepoSlug(slug) {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`invalid repo slug "${slug}", expected owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}
