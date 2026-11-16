import {
  AppWindow,
  Brain,
  Ellipsis,
  FileText,
  Globe,
  Monitor,
  Plug,
  Search,
  SquareTerminal,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Each kind of work's mark (`doing.ts` codes), the same on a working agent's tag and its record. */
export const doingIcons: Record<string, LucideIcon> = {
  browser: Globe,
  web: Search,
  shell: SquareTerminal,
  files: FileText,
  space: StickyNote,
  computer: Monitor,
  app: Plug,
  agents: Users,
  memory: Brain,
  working: AppWindow,
  thinking: Ellipsis,
};

/** What an agent that does a lot of each kind of work is good at, for its record. */
export const skillWords: Record<string, string> = {
  browser: "Web pages",
  web: "Research",
  shell: "Commands",
  files: "Files",
  space: "Space work",
  computer: "Computer use",
  app: "Apps",
  agents: "Teamwork",
  memory: "Memory",
};
