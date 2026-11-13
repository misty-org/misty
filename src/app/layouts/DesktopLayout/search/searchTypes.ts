import type { ReactNode } from "react";
import type { Part } from "./searchRank";

/** The types a search narrows to. "All" shows each type's best few. */
export type SearchKind = "all" | "chats" | "space" | "learn" | "apps" | "settings" | "commands";

/** The search's tabs, each with what its field says while empty: what it searches, no syntax. */
export const searchKinds: { id: SearchKind; label: string; placeholder: string }[] = [
  { id: "all", label: "All", placeholder: "Search" },
  { id: "chats", label: "Chats", placeholder: "Search chats" },
  { id: "space", label: "Space", placeholder: "Search this Space" },
  { id: "learn", label: "Lab", placeholder: "Search the Lab" },
  { id: "apps", label: "Apps", placeholder: "Search apps" },
  { id: "settings", label: "Settings", placeholder: "Search settings" },
  { id: "commands", label: "Commands", placeholder: "Search commands" },
];

/** One thing search found, ready to show and open. */
export interface SearchHit {
  /** Stable across searches: the key, and what opening counts against. */
  id: string;
  kind: Exclude<SearchKind, "all">;
  /** The heading it goes under, such as "Chats" or "Tasks". */
  group: string;
  title: string;
  /** Who or what it belongs to, shown at the right. */
  detail?: string;
  /** The words around the match, for text found inside it. */
  excerpt?: Part[];
  icon: ReactNode;
  updatedAt?: string;
  /** Its match; the list adds recency and use. */
  match: number;
  /** A command's keys. */
  shortcutId?: string;
  open(): void | Promise<void>;
}
