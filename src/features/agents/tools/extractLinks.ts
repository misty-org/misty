/**
 * browser_extract answers through a model, and a model copies long links badly: on Depop it returned
 * a seller's listing links with one character changed in each, and the agent spent minutes fetching
 * pages that don't exist. Every link in an extraction must be one the page links to. A near copy of
 * a page link (same site, a few characters off) is put right; any other is removed, and the result
 * says which. Ported from the server's `browser_extract_links.go`.
 */

const pageLimit = 120_000;

function parse(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

function withoutFragment(url: URL) {
  url.hash = "";
  return url.href;
}

/** The absolute links a page's markdown holds, resolved against its address. */
function pageLinks(markdown: string, base: string): Set<string> {
  const links = new Set<string>();
  const add = (raw: string) => {
    const url = parse(raw.replace(/[.,;]+$/, ""), base || undefined);
    if (url && (url.protocol === "http:" || url.protocol === "https:")) {
      links.add(withoutFragment(url));
    }
  };
  for (const match of markdown.matchAll(/\]\(([^)\s]+)/g)) add(match[1]);
  for (const match of markdown.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) add(match[0]);
  const page = parse(base);
  if (page) links.add(page.href);
  return links;
}

/** A string that is a link (absolute, or a path on the page's site), resolved. */
function linkLike(text: string, base: string): string | null {
  const value = text.trim();
  if (/[ \n\t]/.test(value) || value.length > 2048) return null;
  const absolute = value.startsWith("http://") || value.startsWith("https://");
  if (!absolute && !(value.startsWith("/") && !value.startsWith("//"))) return null;
  const url = parse(value, base || undefined);
  if (!url?.host) return null;
  return withoutFragment(url);
}

/** The Levenshtein distance, giving up once it passes `cap`. */
function editDistance(a: string, b: string, cap: number): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let lowest = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      lowest = Math.min(lowest, current[j]);
    }
    if (lowest > cap) return cap + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** The page link on the same site within a few edits of `link`, or nothing. */
function nearestLink(link: string, links: Set<string>): string | null {
  const target = parse(link);
  if (!target) return null;
  const limit = 3 + Math.floor(link.length / 40);
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const candidate of links) {
    if (parse(candidate)?.host !== target.host) continue;
    if (Math.abs(candidate.length - link.length) > limit) continue;
    const distance = editDistance(link, candidate, bestDistance);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance > limit ? null : best;
}

/** Checks each link-like string in `data` against the page's links. */
function verifyExtractedLinks(data: unknown, markdown: string, base: string) {
  const links = pageLinks(markdown, base);
  let corrected = 0;
  const removed: string[] = [];
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    }
    if (typeof node !== "string") return node;
    const candidate = linkLike(node, base);
    if (!candidate) return node;
    if (links.has(candidate)) return candidate;
    const near = nearestLink(candidate, links);
    if (near) {
      corrected++;
      return near;
    }
    removed.push(node);
    return "";
  };
  return { data: walk(data), corrected, removed };
}

/**
 * browser.extract's result. Links come from the page, never from the model's copy of them. Null when
 * the job came back with no extraction, which is a failed look, not an answer.
 */
export function extractionReply(page: Record<string, unknown>): Record<string, unknown> | null {
  if (page.data === undefined || page.data === null) return null;
  const url = typeof page.url === "string" ? page.url : "";
  let markdown = typeof page.markdown === "string" ? page.markdown : "";
  let truncated = page.truncated === true;
  if (markdown.length > pageLimit) {
    markdown = markdown.slice(0, pageLimit);
    truncated = true;
  }
  const { data, corrected, removed } = verifyExtractedLinks(page.data, markdown, url);
  return {
    data,
    url,
    title: typeof page.title === "string" ? page.title : "",
    pageTruncated: truncated,
    contentTrust: "untrusted-web-page",
    ...(corrected > 0 ? { linksCorrected: corrected } : {}),
    ...(removed.length
      ? {
          linksRemoved: removed,
          note: "Links the page does not hold were removed; open listings by clicking them on the page.",
        }
      : {}),
  };
}
