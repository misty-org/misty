import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["fec0::", 10],
  ["2001::", 32],
  ["2002::", 16],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
blocked.addAddress("::1", "ipv6");

export function publicProviderAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Pin DNS to a public address for each request; never redirect credentials. */
export function providerFetch(baseURL: string): typeof fetch {
  const base = new URL(baseURL);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error("Provider base URL must be public HTTPS");
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (
      url.origin !== base.origin ||
      !(
        url.pathname === base.pathname ||
        url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
      )
    )
      throw new Error("Provider request target changed");
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !publicProviderAddress(address)))
      throw new Error("Provider endpoint resolved to a private or reserved address");
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body;
    if (body != null && typeof body !== "string" && !(body instanceof Uint8Array))
      throw new Error("Unsupported provider request body");
    return await new Promise<Response>((resolve, reject) => {
      const selected = addresses[0]!;
      const req = request(
        url,
        {
          method: init?.method ?? "GET",
          headers,
          family: selected.family,
          signal: init?.signal ?? undefined,
          lookup: (_hostname, _options, callback) =>
            callback(null, selected.address, selected.family),
        },
        (res) => {
          const status = res.statusCode ?? 502;
          if (status < 200 || status >= 300) {
            res.resume();
            // Provider errors may echo credentials. Keep only a safe status.
            resolve(
              new Response(
                JSON.stringify({ error: { message: `Provider request failed (${status})` } }),
                { status, headers: { "content-type": "application/json" } },
              ),
            );
            return;
          }
          const responseHeaders = new Headers();
          for (const name of ["content-type", "x-request-id"]) {
            const value = res.headers[name];
            if (typeof value === "string") responseHeaders.set(name, value);
          }
          resolve(
            new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
              status,
              headers: responseHeaders,
            }),
          );
        },
      );
      req.setTimeout(90_000, () => req.destroy());
      req.on("error", () => reject(new Error("Provider connection failed")));
      req.end(body);
    });
  }) as typeof fetch;
}
