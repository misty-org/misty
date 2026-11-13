import {
  Brain,
  CalendarDays,
  FileText,
  Galaxy,
  KanbanSquare,
  Library,
  Package,
  CalendarClock,
  ListTodo,
  Code2,
  FolderOpen,
  Globe2,
  House,
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
  social: MessagesSquare,
  journal: Notebook,
  memory: Brain,
  files: FolderOpen,
  agents: MessagesSquare,
  scheduled: CalendarClock,
  planner: ListTodo,
  library: Package,
  browser: Globe2,
  code: Code2,
  terminal: SquareTerminal,
  marketplace: Compass,
  music: Music,
  media: Film,
} satisfies Record<string, LucideIcon>;

export const appIconStrokeWidth = 2;

/**
 * A Space and its pages, one icon each wherever they show: the sidebar's Space row, a Space's
 * tabs, the Space's own Pages, and the shortcuts for them. A tab never wears a stand-in such as a
 * house for the Space itself.
 */
export const spaceIcons = {
  space: Galaxy,
  chat: MessagesSquare,
  docs: FileText,
  planner: KanbanSquare,
  calendar: CalendarDays,
  library: Library,
} satisfies Record<string, LucideIcon>;

/** A Space tab's tool (`spaceWorkspaceToolFromRoute`) as `spaceIcons` names it. */
const spaceTools: Record<string, keyof typeof spaceIcons> = {
  home: "space",
  space: "space",
  social: "chat",
  chat: "chat",
  journal: "docs",
  planner: "planner",
  calendar: "calendar",
  library: "library",
};

/** Catalog IDs retain `chat`; workspace routes and navigation use `social`. */
export function appIcon(appId: string, context: "app" | "space" = "app"): LucideIcon | undefined {
  // Inside a Space, its own pages wear the Space's icons, the same as on the Space's page.
  if (context === "space" && spaceTools[appId]) return spaceIcons[spaceTools[appId]];
  const id = appId === "chat" ? "social" : appId;
  return Object.prototype.hasOwnProperty.call(appIcons, id)
    ? appIcons[id as keyof typeof appIcons]
    : undefined;
}
