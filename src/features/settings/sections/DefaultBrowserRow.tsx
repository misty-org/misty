import { settingsDefaultBrowserSnapshot, settingsRequestDefaultBrowser } from "@/native";
import type { DefaultBrowserSnapshot } from "@/native/ipc";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { useEffect, useState } from "react";
import { DesktopSettingsRow } from "../components/DesktopSettingsUI";

/** Makes Misty the system's web browser. macOS asks for confirmation in its own dialog. */
export function DefaultBrowserRow() {
  const [status, setStatus] = useState<DefaultBrowserSnapshot | null>(null);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const refresh = () =>
      void settingsDefaultBrowserSnapshot()
        .then(setStatus)
        .catch(() => setStatus(null));
    refresh();
    // The system confirmation happens outside Misty; re-check when focus returns.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  if (status && !status.supported) return null;
  return (
    <DesktopSettingsRow
      label="Default browser"
      description={
        !hasTauriInternals()
          ? "Available in the desktop app."
          : status?.isDefault
            ? "Links you open in other apps open in Misty."
            : "Open links from other apps in Misty."
      }
    >
      {status?.isDefault ? (
        <span className="text-sm text-cream-muted">Misty is your default browser</span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={!status}
          onClick={() =>
            void settingsRequestDefaultBrowser()
              .then(setStatus)
              .catch(() => undefined)
          }
        >
          Make default
        </Button>
      )}
    </DesktopSettingsRow>
  );
}
