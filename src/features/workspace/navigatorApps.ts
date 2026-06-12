import type { WorkspaceToolId } from "./useRecentToolsStore";

export const NAVIGATOR_APP_IDS = [
  "inbox",
  "social",
  "journal",
  "files",
  "agents",
  "planner",
  "library",
  "browser",
  "code",
  "terminal",
] as const satisfies readonly WorkspaceToolId[];

export type NavigatorAppId = (typeof NAVIGATOR_APP_IDS)[number];

export const DEFAULT_NAVIGATOR_APP_IDS: readonly NavigatorAppId[] = [
  "inbox",
  "social",
  "journal",
  "files",
  "agents",
];

export const NAVIGATOR_APP_DESCRIPTIONS: Record<NavigatorAppId, string> = {
  inbox: "Messages and updates",
  social: "Connected conversations and communities",
  journal: "Notes and drawings for the current Space",
  files: "Browse local and connected files",
  agents: "Create and run AI collaborators",
  planner: "Tasks, agenda, and roadmaps",
  library: "Curated resources for the current Space",
  browser: "Browse the web in Misty",
  code: "Work with code and projects",
  terminal: "Run commands locally",
};

export function isNavigatorAppId(value: string): value is NavigatorAppId {
  return (NAVIGATOR_APP_IDS as readonly string[]).includes(value);
}
