import { AppWindow, Globe2, History, Search, Star } from "lucide-react";
import type { OmniboxMatch } from "./types";

/** The icon that says what choosing a match does: a magnifier searches, a globe opens a page. */
export function omniboxMatchIcon(match: OmniboxMatch) {
  if (match.kind === "search" || match.kind === "suggestion") return Search;
  if (match.kind === "tab") return AppWindow;
  if (match.kind === "bookmark" || match.bookmarked) return Star;
  if (match.kind === "history") return History;
  return Globe2;
}
