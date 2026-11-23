export function unwrapSearchRedirect(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  const host = url.hostname.replace(/^www\./, "");
  let target: string | null = null;
  if (host.endsWith("bing.com") && url.pathname.startsWith("/ck/")) {
    const wrapped = url.searchParams.get("u") ?? "";
    if (/^a1/.test(wrapped)) {
      try {
        const base64 = wrapped.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        target = new TextDecoder().decode(
          Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) =>
            char.charCodeAt(0),
          ),
        );
      } catch {
        target = null;
      }
    }
  } else if (/(^|\.)google\.[a-z.]+$/.test(host) && url.pathname === "/url") {
    target = url.searchParams.get("q") ?? url.searchParams.get("url");
  } else if (host.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")) {
    target = url.searchParams.get("uddg");
  }
  return target && /^https?:\/\//i.test(target) ? target : address;
}
