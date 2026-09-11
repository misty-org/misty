/** Read the OS value injected by the native shell's existing OS plugin.
 * Availability only: the native service still verifies its app session and package.
 */
export function supportsPackagedDocuments(): boolean {
  const native = window as Window & {__TAURI_OS_PLUGIN_INTERNALS__?: {platform?: string}};
  return native.__TAURI_OS_PLUGIN_INTERNALS__?.platform === "macos";
}
