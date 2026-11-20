/** The scheme native serves an installed app's bundle on (`src-tauri/features/apps/scheme.rs`). */
export const APP_SCHEME = "misty-app";

const isWindows = () => typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

/**
 * The address of one file of an app, or its entry page when `file` is left out. Each app is an origin of its own
 * (`misty-app://<id>/<version>/…`); on Windows, where a custom scheme is served over http with one host, the app
 * is named in the path instead.
 */
export function appBundleUrl(appId: string, version: string, file = ""): string {
  const path = file
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .map(encodeURIComponent)
    .join("/");
  const name = `${encodeURIComponent(appId)}/${encodeURIComponent(version)}/${path}`;
  return isWindows() ? `http://${APP_SCHEME}.localhost/${name}` : `${APP_SCHEME}://${name}`;
}
