import {
  ArrowLeftRight,
  BookOpenText,
  Bot,
  CheckSquare2,
  Code2,
  FolderOpen,
  Globe2,
  House,
  Inbox,
  MessagesSquare,
  Notebook,
  SquareTerminal,
  Compass,
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
  planner: CheckSquare2,
  library: BookOpenText,
  browser: Globe2,
  code: Code2,
  terminal: SquareTerminal,
  transfers: ArrowLeftRight,
  marketplace: Compass,
} satisfies Record<string, LucideIcon>;

export const appIconStrokeWidth = 2;

/** Catalog IDs retain `chat`; workspace routes and navigation use `social`. */
export function appIcon(appId: string): LucideIcon | undefined {
  const id = appId === "chat" ? "social" : appId;
  return Object.prototype.hasOwnProperty.call(appIcons, id)
    ? appIcons[id as keyof typeof appIcons]
    : undefined;
}
