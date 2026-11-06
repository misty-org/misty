import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { createBrotliDecompress, createUnzip } from "node:zlib";

// One public page, fetched without cookies or saved sign-ins (docs/agents/harness.md, Reading
// without a screen). This runs on the person's computer on behalf of a model reading untrusted
// pages, so nothing may reach their own network. Every hop is checked before connecting: http or
// https, no credentials in the address, and a host that resolves only to public addresses. The
// check runs inside the connection's own lookup, so the name can't be re-resolved somewhere private.

const maxBytes = 2 * 1024 * 1024;
const maxRedirects = 5;
const timeoutMs = 20_000;
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 MistyFetch/1";
const accept = "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5";
const readableTypes = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"];

/** A short code the tool turns into plain words. */
export class WebFetchFailed extends Error {
  constructor(readonly code: "invalid_url" | "private_address" | "fetch_timeout" | "fetch_failed" | "too_many_redirects" | "unsupported_content") {
    super(code);
  }
}

interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

const refused = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) refused.addSubnet(address, prefix, "ipv4");
// ::/96 also covers :: and ::1. NAT64 and 6to4 addresses can carry a private IPv4 address.
for (const [address, prefix] of [
  ["::", 96], ["64:ff9b::", 96], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as const) refused.addSubnet(address, prefix, "ipv6");

/** Whether an address is on the public internet. IPv4-mapped IPv6 addresses count as their IPv4 address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && !refused.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** The address as a URL this may connect to, or why not. */
function checkedUrl(address: string | URL, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(address, base);
  } catch {
    throw new WebFetchFailed("invalid_url");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname)
    throw new WebFetchFailed("invalid_url");
  return url;
}

type Check = (address: string) => boolean;

/** dns.lookup that refuses a name when any of its addresses isn't public. */
function publicLookup(check: Check) {
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    lookup(hostname, { all: true }, (error, found) => {
      if (error) return callback(error);
      if (!found.length || found.some((item) => !check(item.address))) return callback(new WebFetchFailed("private_address"));
      if (options.all) return callback(null, found);
      callback(null, found[0]!.address, found[0]!.family);
    });
  }) as unknown as typeof lookup;
}

function request(url: URL, check: Check, signal: AbortSignal): Promise<http.IncomingMessage> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal address never reaches the lookup.
  if (isIP(host) && !check(host)) return Promise.reject(new WebFetchFailed("private_address"));
  const send = url.protocol === "https:" ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const outgoing = send(url, {
      method: "GET", agent: false, signal, lookup: publicLookup(check),
      headers: { "User-Agent": userAgent, Accept: accept, "Accept-Encoding": "gzip, deflate, br" },
    }, resolve);
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** Up to maxBytes of the decoded body, and whether there was more. */
async function readBody(response: http.IncomingMessage): Promise<{ body: Buffer; truncated: boolean }> {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  const stream = encoding === "br" ? response.pipe(createBrotliDecompress())
    : encoding === "gzip" || encoding === "deflate" ? response.pipe(createUnzip())
    : response;
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const room = maxBytes - size;
      if (chunk.length >= room) {
        chunks.push(chunk.subarray(0, room));
        truncated = true;
        break;
      }
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally {
    response.destroy();
  }
  return { body: Buffer.concat(chunks), truncated };
}

/** Fetches a public address with every hop checked. Fails with WebFetchFailed. */
export async function fetchPublicPage(address: string, check: Check = isPublicAddress): Promise<FetchedPage> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = checkedUrl(address.trim());
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const response = await request(current, check, signal);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.destroy();
        const location = response.headers.location;
        if (!location) throw new WebFetchFailed("fetch_failed");
        current = checkedUrl(location, current);
        continue;
      }
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (contentType && !readableTypes.some((kind) => contentType.startsWith(kind))) {
        response.destroy();
        throw new WebFetchFailed("unsupported_content");
      }
      const { body, truncated } = await readBody(response);
      return { finalUrl: current.toString(), status, contentType, body: body.toString("utf8"), truncated };
    }
  } catch (error) {
    if (error instanceof WebFetchFailed) throw error;
    // A refused lookup can arrive wrapped when several addresses were tried.
    const inner = (error as { errors?: unknown[] } | null)?.errors?.find((item) => item instanceof WebFetchFailed);
    if (inner) throw inner;
    throw new WebFetchFailed(signal.aborted ? "fetch_timeout" : "fetch_failed");
  }
  throw new WebFetchFailed("too_many_redirects");
}
