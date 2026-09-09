import { blankBrowserUrl, browserSearchEngine, browserSearchUrl } from "@/features/workspace/model";

export interface BrowserSuggestion {
  id: string;
  kind: "site" | "history" | "search";
  title: string;
  detail: string;
  destination: string;
  faviconUrl: string | null;
}

export function buildBrowserSuggestions(
  input: string,
  historyEntries: string[],
  limit = 6,
): BrowserSuggestion[] {
  const value = input.trim();
  const query = value.toLocaleLowerCase();
  const suggestions: BrowserSuggestion[] = [];
  const destinations = new Set<string>();

  const directUrl = directBrowserUrl(value);
  if (directUrl) {
    appendSuggestion(suggestions, destinations, siteSuggestion(directUrl, "site"));
  }

  for (const url of [...historyEntries].reverse()) {
    if (suggestions.length >= limit - (value ? 1 : 0)) break;
    const descriptor = describeUrl(url);
    if (!descriptor) continue;
    if (query && !`${descriptor.title} ${descriptor.detail}`.toLocaleLowerCase().includes(query)) {
      continue;
    }
    appendSuggestion(suggestions, destinations, siteSuggestion(url, "history"));
  }

  if (value && suggestions.length < limit) {
    const destination = browserSearchUrl(value);
    appendSuggestion(suggestions, destinations, {
      id: `search:${destination}`,
      kind: "search",
      title: value,
      detail: `Search with ${browserSearchEngine().name}`,
      destination,
      faviconUrl: null,
    });
  }

  return suggestions.slice(0, limit);
}

function directBrowserUrl(value: string): string | null {
  if (!value || value.includes(" ")) return null;
  const candidate = /^https?:\/\//i.test(value)
    ? value
    : value.includes(".")
      ? `https://${value}`
      : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

function siteSuggestion(url: string, kind: "site" | "history"): BrowserSuggestion {
  const descriptor = describeUrl(url)!;
  return {
    id: `${kind}:${url}`,
    kind,
    title: descriptor.title,
    detail: kind === "history" ? `History · ${descriptor.detail}` : descriptor.detail,
    destination: url,
    // Never turn address-bar drafts into network requests. Favicons are only
    // loaded for pages that already exist in the user's browsing history.
    faviconUrl: kind === "history" ? descriptor.faviconUrl : null,
  };
}

function describeUrl(value: string) {
  if (!value || value === blankBrowserUrl) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !url.hostname) return null;
    const hostname = url.hostname.replace(/^www\./, "");
    const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
    return {
      title: hostname,
      detail: `${hostname}${path}`,
      faviconUrl: `${url.origin}/favicon.ico`,
    };
  } catch {
    return null;
  }
}

function appendSuggestion(
  suggestions: BrowserSuggestion[],
  destinations: Set<string>,
  suggestion: BrowserSuggestion,
) {
  if (destinations.has(suggestion.destination)) return;
  destinations.add(suggestion.destination);
  suggestions.push(suggestion);
}
