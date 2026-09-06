const origin = "https://misty.local";

/** Adapt the shell's App links to the routes used by the existing feature screens. */
export function packageRoute(appId: string, spaceId: string, route: string): string {
  const url = new URL(route, origin);
  if (!spaceId || !url.pathname.startsWith("/apps/")) return local(url);
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  if (appId === "planner") {
    const view = url.searchParams.get("view") || "tasks";
    const section = view === "calendar" ? "agenda" : view;
    const detail =
      section === "agenda"
        ? url.searchParams.get("agendaView") || "month"
        : section === "roadmaps"
          ? url.searchParams.get("roadmap") || ""
          : section === "tasks"
            ? url.searchParams.get("taskView") || "board"
            : "";
    url.pathname = `${base}/planner/${section}${detail ? `/${encodeURIComponent(detail)}` : ""}`;
  } else if (appId === "journal") {
    const drawings = url.searchParams.get("view") === "drawings";
    url.pathname = `${base}/${drawings ? "drawings" : "notes"}`;
    if (drawings && url.searchParams.get("drawing"))
      url.pathname += `/${encodeURIComponent(url.searchParams.get("drawing")!)}`;
    const page = url.searchParams.get(drawings ? "drawingView" : "noteView");
    if (page === "list" || page === (drawings ? "canvas" : "doc"))
      url.searchParams.set("view", page);
    else url.searchParams.delete("view");
    url.searchParams.delete("drawingView");
    url.searchParams.delete("noteView");
  } else if (appId === "chat") {
    url.pathname = `${base}/social/${url.searchParams.get("provider") || "misty"}`;
  } else if (appId === "library") url.pathname = `${base}/library`;
  return local(url);
}

export function hostAppRoute(appId: string, spaceId: string, route: string): string {
  const url = new URL(route, origin);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces") return local(url);
  const ownSections: Record<string, string[]> = {
    planner: ["planner"],
    journal: ["notes", "drawings"],
    chat: ["social"],
    library: ["library"],
  };
  // A feature may link to another Space or feature. Preserve that host route
  // instead of silently converting it to the current App's subsection.
  if (decodeURIComponent(parts[1] || "") !== spaceId || !ownSections[appId]?.includes(parts[2]))
    return local(url);
  url.pathname = `/apps/${appId === "chat" ? "social" : appId}`;
  if (spaceId) url.searchParams.set("space", spaceId);
  if (appId === "planner") {
    const section = parts[3] || "tasks";
    url.searchParams.set("view", section === "board" || section === "list" ? "tasks" : section);
    if (section === "tasks" || section === "board" || section === "list")
      url.searchParams.set("taskView", parts[4] || (section === "list" ? "list" : "board"));
    if (section === "agenda") url.searchParams.set("agendaView", parts[4] || "month");
    if (section === "roadmaps") {
      if (parts[4]) url.searchParams.set("roadmap", decodeURIComponent(parts[4]));
      else url.searchParams.delete("roadmap");
    }
  } else if (appId === "journal") {
    const page = url.searchParams.get("view");
    if (parts[2] === "drawings" && (page === "list" || page === "canvas"))
      url.searchParams.set("drawingView", page);
    else if (parts[2] === "notes" && (page === "list" || page === "doc"))
      url.searchParams.set("noteView", page);
    url.searchParams.set("view", parts[2] === "drawings" ? "drawings" : "notes");
    if (parts[2] === "drawings" && parts[3])
      url.searchParams.set("drawing", decodeURIComponent(parts[3]));
    else url.searchParams.delete("drawing");
  } else if (appId === "chat") url.searchParams.set("provider", parts[3] || "misty");
  return local(url);
}

function local(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}
