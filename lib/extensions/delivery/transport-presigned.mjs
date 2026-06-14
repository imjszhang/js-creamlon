let transportFetch = globalThis.fetch;

export function setPresignedFetch(fn) {
  transportFetch = fn;
}

export async function putBytes(url, bytes, { contentType = 'application/octet-stream' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await transportFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await transportFetch(url, { signal: controller.signal });
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
