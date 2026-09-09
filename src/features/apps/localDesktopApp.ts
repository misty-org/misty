import type { OfficialApp } from "@/api/apps";
import { isTrustedHostApp } from "./trustedHostApps";

export function localDesktopComponentUrl(app: OfficialApp): URL | null {
  if (
    !import.meta.env.DEV ||
    !import.meta.env.VITE_MISTY_APPS_DIRECTORY ||
    !isTrustedHostApp(app) ||
    app.desktop.runtime !== "downloaded"
  )
    return null;
  const entry = `/__misty-local-apps/${encodeURIComponent(app.id)}/desktop/app.js`;
  // The catalog loader selects this entry only after matching the local release
  // and permission contract against the server. Do not infer it from the app ID:
  // newer local code may require capabilities absent from the installed release.
  if (app.desktop.entry !== entry) return null;
  return new URL(entry, window.location.origin);
}

