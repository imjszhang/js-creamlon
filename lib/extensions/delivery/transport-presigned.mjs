let transportFetch = globalThis.fetch;
const PRIVATE_IPV4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

export function setPresignedFetch(fn) {
  transportFetch = fn;
}

export function validatePresignedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('artifact URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('artifact URL must be a credential-free HTTPS URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || hostname.startsWith('fc')
    || hostname.startsWith('fd')
    || hostname.startsWith('fe80:')
    || PRIVATE_IPV4.some((pattern) => pattern.test(hostname))
  ) {
    throw new Error('artifact URL must not target localhost or a private address');
  }
  return url.toString();
}

export async function putBytes(url, bytes, { contentType = 'application/octet-stream' } = {}) {
  const safeUrl = validatePresignedUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await transportFetch(safeUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`artifact upload failed: HTTP ${res.status}`);
    }
    return { ok: true, status: res.status };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('artifact upload timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBytes(url) {
  const safeUrl = validatePresignedUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await transportFetch(safeUrl, { redirect: 'error', signal: controller.signal });
    if (!res.ok) {
      throw new Error(`artifact download failed: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('artifact download timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
