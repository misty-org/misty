import {
  ArrowLeftRight,
  Package,
  BookOpenText,
  Bot,
  ListTodo,
  Code2,
  FolderOpen,
  Globe2,
  House,
  Inbox,
  MessagesSquare,
  Notebook,
  SquareTerminal,
  Compass,
  Music,
  Film,
  type LucideIcon,
} from "lucide-react";

/** App identity shared by navigation, tabs, launchers, and Discover. */
export const appIcons = {
  home: House,
  inbox: Inbox,
  social: MessagesSquare,
  journal: Notebook,
  files: FolderOpen,
  agents: Bot,
  planner: ListTodo,
  library: Package,
  browser: Globe2,
  code: Code2,
  terminal: SquareTerminal,
  transfers: ArrowLeftRight,
  marketplace: Compass,
  music: Music,
  media: Film,
} satisfies Record<string, LucideIcon>;

export const appIconStrokeWidth = 2;

/** Catalog IDs retain `chat`; workspace routes and navigation use `social`. */
export function appIcon(appId: string, context: "app" | "space" = "app"): LucideIcon | undefined {
  // Storage retains the legacy catalog ID `library`; Space Library is a native tool.
  if (appId === "library" && context === "space") return BookOpenText;
  const id = appId === "chat" ? "social" : appId;
  return Object.prototype.hasOwnProperty.call(appIcons, id)
    ? appIcons[id as keyof typeof appIcons]
    : undefined;
}
