import { createContext, useContext } from "react";
import type { EntryOf, ListingKind } from "@/native/registry";

export const explorePages = [
  "all",
  "apps",
  "templates",
  "skills",
  "plugins",
  "mcps",
  "engines",
  "speech",
  "mine",
] as const;
export type ExplorePage = (typeof explorePages)[number];

const aliases: Record<string, ExplorePage> = {
  agents: "templates",
  personas: "templates",
  mcp: "mcps",
  connections: "mcps",
  updates: "mine",
  installed: "mine",
};

export function pageOf(tab: string | null): ExplorePage {
  if (!tab) return "all";
  if ((explorePages as readonly string[]).includes(tab)) return tab as ExplorePage;
  return aliases[tab] ?? "all";
}

export type ListingItem = { [K in ListingKind]: { kind: K; entry: EntryOf<K> } }[ListingKind];

export type ExploreItem =
  | ListingItem
  | { kind: "apps"; id: string }
  | { kind: "engines"; id: string }
  | { kind: "hearing"; id: string };

export type ExploreView =
  | { at: "page"; page: ExplorePage }
  | { at: "search"; query: string; within: ExplorePage }
  | { at: "list"; kind: ListingKind; category: string | null; query?: string };

export interface BarAction {
  label: string;
  variant: "get" | "secondary";
  disabled?: boolean;
  progress?: { value?: number };
  onClick: () => void;
}

export interface ExploreNav {
  go(view: ExploreView): void;
  open(item: ExploreItem): void;
  close(): void;
  back(): void;
}

export const ExploreNavContext = createContext<ExploreNav | null>(null);

export function useExploreNav(): ExploreNav {
  const nav = useContext(ExploreNavContext);
  if (!nav) throw new Error("Explore's pages are drawn inside ExplorePage");
  return nav;
}

export const itemKey = (item: ExploreItem) =>
  `${item.kind}:${"entry" in item ? item.entry.id : item.id}`;
