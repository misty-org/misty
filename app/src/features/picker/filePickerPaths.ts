export function joinPath(parent: string, child: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

export function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(configuredPath)) return configuredPath.replace(/[\\/]+$/, "");
  return joinPath(homePath, configuredPath.replace(/^[\\/]+|[\\/]+$/g, ""));
}

export function resolvePreferredRoot(configuredPath: string, homePath: string): string {
  const trimmed = configuredPath.trim();
  if (!trimmed || trimmed === "~") return homePath;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\"))
    return joinPath(homePath, trimmed.slice(2));
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(trimmed)) return trimmed;
  return joinPath(homePath, trimmed);
}
