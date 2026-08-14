/** Pure helpers for device workflow jobs: content references and error codes. */

export function deviceContentReference(
  input: unknown,
  expectedScopeId: string,
): Record<string, string> {
  const ref = findDeviceContentReference(input);
  if (
    !ref ||
    ref.scopeId !== expectedScopeId ||
    !ref.relativePath ||
    ref.relativePath.startsWith("/") ||
    ref.relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("invalid_device_scope");
  }
  return { ...ref, scopeId: expectedScopeId, relativePath: ref.relativePath };
}

function findDeviceContentReference(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = (record.contentRef ?? record.content) as Record<string, unknown> | undefined;
  const source = candidate && typeof candidate === "object" ? candidate : record;
  const scopeId = stringValue(source.scopeId) || stringValue(source.permissionScope);
  const relativePath = stringValue(source.relativePath) || stringValue(source.locator);
  if (scopeId && relativePath) {
    return {
      ...Object.fromEntries(
        Object.entries(source).map(([key, entry]) => [key, stringValue(entry)]),
      ),
      scopeId,
      relativePath,
    };
  }
  for (const child of Object.values(record)) {
    const found = findDeviceContentReference(child);
    if (found) return found;
  }
  return null;
}

export function deviceWorkflowErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Add Files")) return "files_app_required";
  if (message.includes("document service") || message.includes("processor"))
    return "document_service_unavailable";
  if (message.startsWith("browser_snapshot_stale:")) return "browser_snapshot_stale";
  if (message.includes("unsupported_content")) return "unsupported_content";
  if (message.includes("invalid_device_scope")) return "invalid_scope";
  if (message.includes("unsupported_device_operation")) return "unsupported_operation";
  if (message.includes("invalid_browser_grant") || message.includes("not active"))
    return "browser_grant_invalid";
  if (
    message.includes("browser_context_closed") ||
    message.includes("not open") ||
    message.includes("not running")
  )
    return "browser_tab_closed";
  if (message.includes("timed out")) return "browser_timeout";
  if (message.includes("inspect it again") || message.includes("page changed"))
    return "browser_snapshot_stale";
  if (message.includes("device_node_timeout")) return "device_timeout";
  return "device_execution_failed";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
