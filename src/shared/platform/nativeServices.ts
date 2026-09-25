/** Read the OS value injected by the native shell's existing OS plugin.
 * Availability only: bundled workers still require a current account and native file grants.
 */
export function supportsBundledDocumentWorkers(): boolean {
  const native = window as Window & { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } };
  return native.__TAURI_OS_PLUGIN_INTERNALS__?.platform === "macos";
}
