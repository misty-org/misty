import type { ReactNode } from "react";
import type { Part } from "./searchRank";

/** The types a search narrows to. "All" shows each type's best few. */
export type SearchKind = "all" | "chats" | "space" | "learn" | "apps" | "settings" | "commands";

export const searchKinds: { id: SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "chats", label: "Chats" },
  { id: "space", label: "Space" },
  { id: "learn", label: "Tutor" },
  { id: "apps", label: "Apps" },
  { id: "settings", label: "Settings" },
  { id: "commands", label: "Commands" },
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
