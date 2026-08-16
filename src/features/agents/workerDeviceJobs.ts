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
  if (message.includes("failed to send message to the webview"))
    return "browser_webview_unavailable";
  if (message.includes("→ Accessibility to control the desktop, then retry."))
    return "desktop_accessibility_required";
  if (message.includes("→ Screen Recording, then retry."))
    return "desktop_screen_recording_required";
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

/** Preserve uncertainty while exposing only host-defined failure categories. */
export function browserUncertainErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const nativeCodes = [
    "agent_task_paused:scope_task_mismatch",
    "agent_task_paused:scope_agent_mismatch",
    "agent_task_paused:native_lease_missing",
    "agent_task_paused:native_lease_expired",
    "agent_task_paused:native_lease_owner_mismatch",
    "invalid_device_deadline",
    "device_execution_expired",
    "device_execution_stopped",
    "device_execution_mismatch",
    "device_execution_missing",
    "device_execution_capacity",
    "invalid_device_execution",
    "device_control_unavailable",
    "agent_task_paused",
    "agent_task_mismatch",
    "agent_workspace_unavailable",
    "browser_document_changed",
    "browser_authentication_required",
  ];
  const nativeCode = nativeCodes.find((code) => message === code || message.startsWith(`${code}:`));
  let category = nativeCode;
  if (!category && message.startsWith("Browser snapshot was invalid:"))
    category = "browser_snapshot_invalid";
  if (!category && message.startsWith("Browser page returned invalid data:"))
    category = "browser_evaluation_invalid";
  if (!category && message === "Browser page evaluation was canceled.")
    category = "browser_evaluation_canceled";
  if (!category && /^(ReferenceError|TypeError|SyntaxError|SecurityError):/.test(message))
    category = "browser_script_error";
  if (!category && message === "Browser agent access was revoked.")
    category = "browser_grant_revoked";
  if (!category) {
    const known = deviceWorkflowErrorCode(error);
    if (known !== "device_execution_failed") category = known;
  }
  return category ? `device_execution_uncertain:${category}` : "device_execution_uncertain";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Native stale-frame errors are emitted before any input is dispatched. */
export function isBrowserSnapshotStale(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("browser_snapshot_stale:");
}
