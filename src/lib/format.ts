export function prettyLabel(value: string): string {
  return value.split("_").join(" ");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function userFacingErrorText(error: unknown): string {
  const raw = errorText(error).trim();
  const normalized = raw.toLowerCase();

  if (!raw) return "Something went wrong.";
  if (
    normalized.includes("directory not found") ||
    normalized.includes("object not found") ||
    normalized.includes("not found in its parent directory") ||
    normalized.includes("os error 2")
  ) {
    return "That file or folder could not be found. Refresh the folder or reindex search, then try again.";
  }
  if (normalized.includes("remote") && normalized.includes("not found")) {
    return "That remote is not available yet. Refresh remotes and try again.";
  }
  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return "The operation took too long. Check the connection and try again.";
  }
  if (normalized.includes("permission denied") || normalized.includes("access denied")) {
    return "Misty does not have permission to access that item.";
  }
  if (
    normalized.includes("connection refused") ||
    normalized.includes("network") ||
    normalized.includes("transport error")
  ) {
    return "Misty could not reach the remote service. Check the connection and try again.";
  }
  if (raw.length > 220) return `${raw.slice(0, 217).trimEnd()}...`;
  return raw;
}
