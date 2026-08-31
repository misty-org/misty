export interface ExtensionAppRoute {
  pluginId: string;
  title: string;
  selectedPaths: string[];
}

export function extensionAppRoute(
  pluginId: string,
  options: { title?: string; selectedPaths?: readonly string[] } = {},
): string {
  const id = pluginId.trim();
  if (!id) return "/apps";
  const params = new URLSearchParams();
  const title = options.title?.trim();
  if (title) params.set("name", title);
  for (const path of options.selectedPaths ?? []) {
    if (path.trim()) params.append("selected", path);
  }
  const query = params.toString();
  return `/apps/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

export function parseExtensionAppRoute(route: string): ExtensionAppRoute | null {
  try {
    const parsed = new URL(route, "https://misty.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "apps" || !parts[1]) return null;
    const pluginId = decodeURIComponent(parts[1]);
    return {
      pluginId,
      title: parsed.searchParams.get("name")?.trim() || fallbackAppTitle(pluginId),
      selectedPaths: parsed.searchParams
        .getAll("selected")
        .map((path) => path.trim())
        .filter(Boolean),
    };
  } catch {
    return null;
  }
}

function fallbackAppTitle(pluginId: string): string {
  if (pluginId === "ytdlp" || pluginId === "yt-dlp") return "yt-dlp";
  return pluginId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}
