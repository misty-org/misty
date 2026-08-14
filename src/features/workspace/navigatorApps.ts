import type { WorkspaceToolId } from "./useRecentToolsStore";

export const NAVIGATOR_APP_IDS = [
  "social",
  "journal",
  "files",
  "agents",
  "planner",
  "library",
  "browser",
] as const satisfies readonly WorkspaceToolId[];

export type NavigatorAppId = (typeof NAVIGATOR_APP_IDS)[number];

export const DEFAULT_NAVIGATOR_APP_IDS: readonly NavigatorAppId[] = [
  "social",
  "journal",
  "files",
  "agents",
];

export function isNavigatorAppId(value: string): value is NavigatorAppId {
  return (NAVIGATOR_APP_IDS as readonly string[]).includes(value);
}
