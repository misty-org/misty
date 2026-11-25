import { createContext, useContext, useEffect, useRef } from "react";
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
  | { at: "search"; query: string }
  | { at: "list"; kind: ListingKind; category: string | null; query?: string }
  | { at: "item"; item: ExploreItem };

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
  manage(item: ExploreItem): void;
  closeManage(): void;
  back(): void;
  setPinned(pinned: boolean): void;
  setBarAction(
    action: Omit<BarAction, "onClick"> | null,
    onClick?: () => void,
    title?: string,
  ): void;
}

export const ExploreNavContext = createContext<ExploreNav | null>(null);

export function useExploreNav(): ExploreNav {
  const nav = useContext(ExploreNavContext);
  if (!nav) throw new Error("Explore's pages are drawn inside ExplorePage");
  return nav;
}

export function useBarAction(action: BarAction | null, title?: string) {
  const { setBarAction } = useExploreNav();
  const handler = useRef(action?.onClick);
  handler.current = action?.onClick;
  const label = action?.label;
  const variant = action?.variant;
  const disabled = action?.disabled ?? false;
  const downloading = Boolean(action?.progress);
  const value = action?.progress?.value;
  useEffect(() => {
    setBarAction(
      label && variant
        ? { label, variant, disabled, progress: downloading ? { value } : undefined }
        : null,
      () => handler.current?.(),
      title,
    );
  }, [label, variant, disabled, downloading, value, title, setBarAction]);
  useEffect(() => () => setBarAction(null), [setBarAction]);
}

export const itemKey = (item: ExploreItem) =>
  `${item.kind}:${"entry" in item ? item.entry.id : item.id}`;
