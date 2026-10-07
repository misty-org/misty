import { bangNames } from "./catalog";
import type { Bang, WebBang } from "./types";

const bangWord = "!([a-z0-9][a-z0-9.-]*)";
const leading = new RegExp(`^${bangWord}\\s(.*)$`, "is");
const trailing = new RegExp(`^(.*\\S)\\s+${bangWord}$`, "is");

function findBang(word: string, bangs: readonly Bang[]): Bang | undefined {
  const name = word.toLowerCase();
  return bangs.find((bang) => bangNames(bang).includes(name));
}

/**
 * `!yt cats` picks a shortcut once the name is followed by a space. An unknown
 * name is not a shortcut, so the whole text stays one plain query; so does a
 * path like `/usr/bin`.
 */
export function parseLeadingBang(
  input: string,
  bangs: readonly Bang[],
): { bang: Bang; query: string } | null {
  const front = leading.exec(input.trimStart());
  if (!front) return null;
  const bang = findBang(front[1], bangs);
  return bang ? { bang, query: front[2] } : null;
}

/**
 * Also reads `cats !yt` from the end, as on DuckDuckGo. Only used on submit,
 * so a half-typed `!rs` is never taken for `!r` mid-word.
 */
export function parseBang(
  input: string,
  bangs: readonly Bang[],
): { bang: Bang; query: string } | null {
  const front = parseLeadingBang(input, bangs);
  if (front) return front;
  const back = trailing.exec(input.trim());
  if (back) {
    const bang = findBang(back[2], bangs);
    if (bang) return { bang, query: back[1].trim() };
  }
  return null;
}

/** Shortcuts to offer while a bare `!word` is being typed: name matches first, then label words. */
export function matchingBangs(input: string, bangs: readonly Bang[]): Bang[] {
  const match = /^!([a-z0-9.-]*)$/i.exec(input.trim());
  if (!match) return [];
  const prefix = match[1].toLowerCase();
  if (!prefix) return [...bangs];
  const byName = bangs.filter((bang) => bangNames(bang).some((name) => name.startsWith(prefix)));
  const byLabel = bangs.filter(
    (bang) =>
      !byName.includes(bang) &&
      bang.label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((word) => word.startsWith(prefix)),
  );
  return [...byName, ...byLabel];
}

/**
 * Where a website shortcut goes: its front page without a query, otherwise its
 * search. Custom templates come from synced settings, so anything that does
 * not resolve to http or https is refused.
 */
export function bangDestination(bang: WebBang, query: string): string | null {
  const text = query.trim();
  const target = text ? bang.url.replace("%s", encodeURIComponent(text)) : bang.home;
  try {
    const url = new URL(target);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
