import { booleanSetting } from "@/features/settings/SettingsControls";

/** Which of the optional sources a search asks, as the person set them in Settings › Search. */
export function selectSearchSources(document?: Record<string, unknown> | null) {
  const source = document ?? {};
  const files = booleanSetting(source, "search", "project_files", true);
  const apps = booleanSetting(source, "search", "apps", true);
  const sessions = booleanSetting(source, "search", "agent_sessions", true);
  return { files, apps, sessions, key: `${+files}${+apps}${+sessions}` } as const;
}
