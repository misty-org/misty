import { useSettingsStore } from "@/features/settings";

/** The section a Space opens on, from the person's opening-tool preference. */
export function defaultSpaceRoute(spaceId: string): string {
  const preferences = useSettingsStore.getState().settings?.document.spaces as
    Record<string, unknown> | undefined;
  const tool = String(preferences?.opening_tool ?? "home");
  // Older choices (Journal, Planner) open on Notes and the Space home.
  const route =
    tool === "journal"
      ? "notes"
      : ["home", "chat", "notes", "drawings", "library", "code"].includes(tool)
        ? tool
        : "home";
  return `/spaces/${encodeURIComponent(spaceId)}/${route}`;
}
