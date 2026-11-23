import type { ReactNode } from "react";
import type { Part } from "./search_rank";

export type SearchKind =
  "all" | "chats" | "space" | "learn" | "apps" | "settings" | "commands" | "files";

export const searchKinds: { id: SearchKind; label: string; placeholder: string }[] = [
  { id: "all", label: "All", placeholder: "Search" },
  { id: "chats", label: "Chats", placeholder: "Search chats" },
  { id: "space", label: "Space", placeholder: "Search this Space" },
  { id: "learn", label: "Lessons", placeholder: "Search lessons" },
  { id: "apps", label: "Apps", placeholder: "Search apps" },
  { id: "settings", label: "Settings", placeholder: "Search settings" },
  { id: "commands", label: "Commands", placeholder: "Search commands" },
];

export interface SearchHit {
  id: string;
  kind: Exclude<SearchKind, "all">;
  group: string;
  title: string;
  detail?: string;
  excerpt?: Part[];
  icon: ReactNode;
  updatedAt?: string;
  match: number;
  shortcutId?: string;
  open(): void | Promise<void>;
}
