import {
  blankBrowserUrl,
  browserInternalPage,
  browserInternalUrl,
  browserSearchUrl,
} from "@/features/workspace/model";

const LOCAL_TLD_RE = /\.(?:local|internal|lan|localhost)$/i;
const IPV4_SEGMENT_RE = /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
const HOSTNAME_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

export function isIpv4Address(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => IPV4_SEGMENT_RE.test(part));
}

export function isIpv6Address(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.length > 2 && host.includes(":");
  }
  return host.includes("::") || (host.includes(":") && /^[0-9a-fA-F:]+$/.test(host));
}

export function isLocalHostOrDomain(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === "localhost" || lower.endsWith(".localhost") || LOCAL_TLD_RE.test(lower);
}

export interface ParsedAuthority {
  host: string;
  port?: number;
  isIpv6Bracketed?: boolean;
}

export function parseAuthority(authority: string): ParsedAuthority | null {
  const ipv6Match = authority.match(/^(\[[0-9a-fA-F:]+\])(?::(\d+))?$/);
  if (ipv6Match) {
    const port = ipv6Match[2] ? Number.parseInt(ipv6Match[2], 10) : undefined;
    if (port !== undefined && (port < 1 || port > 65535)) return null;
    return { host: ipv6Match[1], port, isIpv6Bracketed: true };
  }

  if (
    authority.includes("::") ||
    (authority.split(":").length > 2 && /^[0-9a-fA-F:]+$/.test(authority))
  ) {
    return { host: `[${authority}]`, isIpv6Bracketed: true };
  }

  const portMatch = authority.match(/^([^:]+):(\d+)$/);
  if (portMatch) {
    const port = Number.parseInt(portMatch[2], 10);
    if (port < 1 || port > 65535) return null;
    return { host: portMatch[1], port };
  }

  if (!authority.includes(":")) {
    return { host: authority };
  }

  return null;
}

export function isLocalOrIpAddress(parsed: ParsedAuthority): boolean {
  const { host, port, isIpv6Bracketed } = parsed;
  if (isLocalHostOrDomain(host)) return true;
  if (isIpv4Address(host)) return true;
  if (isIpv6Bracketed || isIpv6Address(host)) return true;
  if (port !== undefined && !host.includes(".")) return true;
  return false;
}

/**
 * Resolves a raw input string to a direct HTTP/HTTPS web address or native blank page.
 * Returns null if the input should fall back to web search.
 */
export function resolveDirectAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return blankBrowserUrl;
  if (trimmed === blankBrowserUrl || /^about:/i.test(trimmed)) return trimmed;
  const internal = browserInternalPage(trimmed);
  if (internal) return browserInternalUrl(internal);
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(" ")) return null;

  const match = trimmed.match(/^([^/?#]+)(.*)$/);
  if (!match) return null;

  const rawAuthority = match[1];
  const path = match[2];
  const parsed = parseAuthority(rawAuthority);
  if (!parsed) return null;

  if (isLocalOrIpAddress(parsed)) {
    const portPart = parsed.port !== undefined ? `:${parsed.port}` : "";
    return `http://${parsed.host}${portPart}${path}`;
  }

  if (parsed.host.includes(".") && HOSTNAME_RE.test(parsed.host)) {
    const portPart = parsed.port !== undefined ? `:${parsed.port}` : "";
    return `https://${parsed.host}${portPart}${path}`;
  }

  return null;
}

/**
 * Normalizes user-typed input into a destination URL:
 * - Local ports, localhost, IP addresses, and local domains connect via HTTP.
 * - Public domain names connect via HTTPS.
 * - Explicit http:// and https:// URLs are preserved.
 * - Blank inputs return about:blank.
 * - Unrecognized strings or search terms fall back to the configured search engine.
 */
export function normalizeBrowserAddress(value: string): string {
  const direct = resolveDirectAddress(value);
  if (direct) return direct;
  return browserSearchUrl(value.trim());
}
