import { blankBrowserUrl } from "@/features/workspace/model";
import { resolveDirectAddress } from "../browserAddress";

/** An http(s) page address, or null for anything the address bar should not list. */
export function webUrl(value: string): URL | null {
  if (!value || value === blankBrowserUrl) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** The address as people type it: no scheme, no `www.`, no bare trailing slash. */
export function strippedUrl(value: string): string {
  const url = webUrl(value);
  if (!url) return value;
  const host = url.host.replace(/^www\./i, "");
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${host}${path}${url.search}${url.hash}`;
}

/** Identity for merging matches that point at the same page. */
export function urlKey(value: string): string {
  return strippedUrl(value).toLowerCase().replace(/\/$/, "");
}

/** Typed text in the same form as `strippedUrl`, for prefix comparison. */
export function typedUrlText(text: string): string {
  return text
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/** The web page a typed address names directly, if it names one. */
export function directWebUrl(text: string): string | null {
  const direct = resolveDirectAddress(text.trim());
  return direct ? (webUrl(direct)?.toString() ?? null) : null;
}

/**
 * The rest of `url` after the typed text, when the typed text is a prefix of
 * the address as people type it. `git` completes `github.com` with `hub.com`.
 */
export function inlineCompletion(text: string, url: string): string | undefined {
  const typed = typedUrlText(text);
  if (!typed || /\s/.test(typed)) return undefined;
  const stripped = strippedUrl(url);
  if (!stripped.toLowerCase().startsWith(typed) || stripped.length === typed.length) return undefined;
  return stripped.slice(typed.length);
}

export function describeUrl(value: string): { title: string; detail: string; faviconUrl: string } | null {
  const url = webUrl(value);
  if (!url) return null;
  const detail = strippedUrl(value);
  return { title: url.host.replace(/^www\./i, ""), detail, faviconUrl: `${url.origin}/favicon.ico` };
}
