export function titleFromPath(path: string): string {
  if (path === "misty://local") return "Local";
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  const normalized = path.replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) || normalized : normalized;
}

export function resolvePreferredWorkspaceRoot(
  preferredWorkspaceRoot: string,
  fallbackHomePath: string,
): string {
  const trimmed = preferredWorkspaceRoot.trim();
  if (!trimmed || trimmed === "~") return fallbackHomePath;
  if (trimmed.startsWith("~/")) return joinPath(fallbackHomePath, trimmed.slice(2));
  if (isAbsolutePath(trimmed)) return normalizedPath(trimmed) || fallbackHomePath;
  return joinPath(fallbackHomePath, trimmed);
}

export function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (isAbsolutePath(configuredPath)) return configuredPath.replace(/\/+$/, "");
  return `${homePath.replace(/\/+$/, "")}/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
}

export function joinPath(base: string, child: string): string {
  if (!child) return normalizedPath(base) || "/";
  if (isAbsolutePath(child)) return normalizedPath(child) || child;
  const cleanBase = (normalizedPath(base) || "/").replace(/\/+$/, "");
  const cleanChild = child.replace(/^\/+/, "");
  if (!cleanBase || cleanBase === "/") return `/${cleanChild}`;
  return `${cleanBase}/${cleanChild}`;
}

function normalizedPath(path: string): string {
  const collapsed = path.trim().replace(/\/+/g, "/");
  if (collapsed.length > 1) return collapsed.replace(/\/+$/, "");
  return collapsed;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}
