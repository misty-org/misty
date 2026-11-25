import { useEffect, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  listingKinds,
  registryShards,
  useRegistry,
  type EntryOf,
  type ListingEntry,
  type ListingKind,
  type Shard,
} from "@/native/registry";

export type ExploreSort = "popular" | "name" | "maker";

export const kindNames: Record<ListingKind, { many: string; one: string; counted: string }> = {
  templates: { many: "Templates", one: "template", counted: "templates" },
  skills: { many: "Skills", one: "skill", counted: "skills" },
  plugins: { many: "Plugins", one: "plugin", counted: "plugins" },
  mcps: { many: "MCP servers", one: "MCP server", counted: "MCP servers" },
};

export const failureText = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message
    ? reason.message
    : typeof reason === "string" && reason
      ? reason
      : fallback;

export function rankText(rank: number | undefined) {
  if (!rank) return "";
  if (rank >= 1000) return `${(rank / 1000).toFixed(rank >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(rank);
}

export function wordsMatch(query: string, ...texts: (string | undefined)[]) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = texts.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function sorted<T extends ListingEntry>(items: readonly T[], sort: ExploreSort): T[] {
  const byRank = (a: T, b: T) => (b.rank ?? 0) - (a.rank ?? 0) || a.name.localeCompare(b.name);
  const order =
    sort === "name"
      ? (a: T, b: T) => a.name.localeCompare(b.name)
      : sort === "maker"
        ? (a: T, b: T) => a.maker.localeCompare(b.maker) || byRank(a, b)
        : byRank;
  return [...items].sort(order);
}

export const useCategories = () => useRegistry((state) => state.categories);
export const useListing = (kind: ListingKind) => useRegistry((state) => state.listings[kind]);

export function useTopShard<K extends ListingKind>(kind: K) {
  const sha = useListing(kind)?.top.sha256 ?? "";
  return useCachedResource<Shard<K>>(sha ? `registry/top:${kind}:${sha}` : null, () =>
    registryShards.top(kind),
  );
}

export function useCategoryShard<K extends ListingKind>(kind: K, category: string | null) {
  const sha = useListing(kind)?.categories[category ?? ""]?.sha256 ?? "";
  return useCachedResource<Shard<K>>(
    category && sha ? `registry/category:${kind}:${sha}` : null,
    () => registryShards.category(kind, category ?? ""),
  );
}

export type SearchHits = { [K in ListingKind]: EntryOf<K>[] };
export type SearchCounts = Record<ListingKind, number>;

export function useListingSearch(
  query: string,
  options: { kind?: ListingKind; limit?: number } = {},
) {
  const [term, setTerm] = useState(query.trim());
  useEffect(() => {
    const next = query.trim();
    const timer = window.setTimeout(() => setTerm(next), next ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);
  const [found, setFound] = useState<{
    term: string;
    hits: SearchHits;
    counts: SearchCounts;
  } | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const { kind, limit = 6 } = options;
  useEffect(() => {
    if (!term) return;
    let live = true;
    setError("");
    registryShards.search(term, kind, limit).then(
      (answer) => {
        if (!live) return;
        const hits = Object.fromEntries(
          listingKinds.map((one) => [one, answer[one]?.items ?? []]),
        ) as SearchHits;
        const counts = Object.fromEntries(
          listingKinds.map((one) => [one, answer[one]?.count ?? 0]),
        ) as SearchCounts;
        setFound({ term, hits, counts });
      },
      (reason: unknown) => live && setError(failureText(reason, "Explore couldn't search.")),
    );
    return () => {
      live = false;
    };
  }, [term, kind, limit, round]);
  const current = found && found.term === term ? found : null;
  return {
    term,
    hits: current?.hits ?? null,
    counts: current?.counts ?? null,
    error,
    retry: () => setRound((value) => value + 1),
  };
}

export function frontMatter(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { fields: {} as Record<string, string>, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fields, body: markdown.slice(match[0].length) };
}
