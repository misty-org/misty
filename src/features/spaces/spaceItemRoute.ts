/** Canonical content identity. Tool indexes and UI-only query parameters never become recents. */
export function spaceItemKeyFromRoute(route: string, spaceId: string): string | undefined {
  const url = new URL(route, "https://misty.invalid");
  const base = `/spaces/${encodeURIComponent(spaceId)}/`;
  if (!url.pathname.startsWith(base)) return;
  const [section, detail] = url.pathname.slice(base.length).split("/");
  let kind = "";
  let id: string | null | undefined;
  if (section === "notes") {
    kind = "note";
    id = url.searchParams.get("note");
  }
  if (section === "drawings") {
    kind = "drawing";
    id = detail;
  }
  if (section === "planner") {
    kind = "task";
    id = url.searchParams.get("task");
  }
  if (
    section === "library" &&
    url.searchParams.get("collection") !== "deleted" &&
    url.searchParams.get("collection") !== "recently-deleted"
  ) {
    kind = "file";
    id = url.searchParams.get("item");
  }
  if (section === "social" || section === "chat") {
    kind = "chat";
    id = url.searchParams.get("conversation") || (detail === "misty" ? "everyone" : undefined);
  }
  if (!id) return;
  try {
    id = decodeURIComponent(id);
  } catch {
    return;
  }
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? `${kind}:${id}` : undefined;
}
