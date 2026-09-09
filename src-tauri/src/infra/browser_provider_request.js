// Arguments are JSON literals supplied by the native host, never executable app code.
const target = new URL(path, location.href);
if (location.origin !== origin || target.origin !== origin || target.protocol !== "https:" || target.username || target.password)
  throw new Error("The provider account page changed. Open it again before requesting data.");
const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(), 15000);
try {
  const response = await fetch(target.href, { method: "GET", credentials: "same-origin", redirect: "error", signal: abort.signal, headers: { Accept: "application/json" } });
  const reader = response.body?.getReader();
  let bytes = 0, body = "", truncated = false;
  const decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = 262144 - bytes;
      bytes += value.byteLength;
      body += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: true });
      if (bytes > 262144) { truncated = true; await reader.cancel(); break; }
    }
    body += decoder.decode();
  }
  if (location.origin !== origin) throw new Error("The provider page changed during the request.");
  return JSON.stringify({ status: response.status, body, truncated });
} finally { clearTimeout(timeout); }
