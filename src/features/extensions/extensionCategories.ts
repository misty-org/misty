import {
  Bell,
  BookOpen,
  Bookmark,
  Clapperboard,
  Code,
  FolderDown,
  Gamepad2,
  Languages,
  MessagesSquare,
  Palette,
  PanelsTopLeft,
  Search,
  Shapes,
  Shield,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import type { ItemTone } from "@/shared/ui";

export type ExtensionCategory = { id: string; name: string; Icon: LucideIcon };

export const defaultCategories: ExtensionCategory[] = [
  { id: "privacy-security", name: "Privacy and security", Icon: Shield },
  { id: "tabs", name: "Tabs", Icon: PanelsTopLeft },
  { id: "web-development", name: "Developer tools", Icon: Code },
  { id: "feeds-news-blogging", name: "Reading and news", Icon: BookOpen },
];
// Mozilla category slugs that are only known once the live list loads.
const categoryIcons: Record<string, LucideIcon> = {
  "alerts-updates": Bell,
  appearance: Palette,
  bookmarks: Bookmark,
  "download-management": FolderDown,
  "games-entertainment": Gamepad2,
  "language-support": Languages,
  "photos-music-videos": Clapperboard,
  "search-tools": Search,
  shopping: ShoppingCart,
  "social-communication": MessagesSquare,
  other: Shapes,
};
// The rail is the one sidebar whose icons carry item tones; see AGENTS.md.
export const categoryTones: Record<string, ItemTone> = {
  "privacy-security": "green",
  tabs: "blue",
  "web-development": "teal",
  "feeds-news-blogging": "orange",
  "alerts-updates": "amber",
  appearance: "violet",
  bookmarks: "red",
  "download-management": "sand",
  "games-entertainment": "pink",
  "language-support": "blue",
  "photos-music-videos": "violet",
  "search-tools": "teal",
  shopping: "amber",
  "social-communication": "teal",
  other: "sand",
};

/** Gives each category from the live list its icon. */
export function withCategoryIcons(categories: { id: string; name: string }[]): ExtensionCategory[] {
  return categories.map((category) => ({
    ...category,
    Icon:
      defaultCategories.find((v) => v.id === category.id)?.Icon ??
      categoryIcons[category.id] ??
      Shapes,
  }));
}
