import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { Button } from "@/shared/ui";
import {
  permissionLabels,
  supportsSitePermissions,
  type SavedSitePermission,
} from "@/features/browser-workspace/sitePermissions";

export function BrowserPermissionSettings() {
  const [entries, setEntries] = useState<SavedSitePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = supportsSitePermissions();
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await invoke<SavedSitePermission[]>("browser_site_permissions_list"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);
  if (!supported) return null;
  const reset = async (entry: SavedSitePermission) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("browser_site_permissions_reset", {
        profile: entry.profile,
        origin: entry.origin,
      });
      await load();
    } catch (reason) {
      // Reset may have persisted before native capture shutdown failed.
      await load();
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DesktopSettingsSection
      title="Website permissions"
      description="Saved choices for open browser profiles. Websites ask before using your camera or microphone. Change a site's choices from the information button beside its address. Resetting stops capture in that browser profile."
    >
      {loading ? (
        <p role="status" className="p-4 text-sm text-cream-muted">
          Loading website permissions…
        </p>
      ) : !error && entries.length === 0 ? (
        <p className="p-4 text-sm text-cream-muted">
          No saved choices for open browser profiles. Websites use the default Ask setting.
        </p>
      ) : (
        <ul className="divide-y divide-charcoal-border">
          {entries.map((entry) => (
            <li
              key={`${entry.profile}:${entry.origin}`}
              className="flex items-center gap-4 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm">{entry.origin}</p>
                <p className="mt-1 text-xs text-cream-muted">
                  Camera: {permissionLabels[entry.permissions.camera]} · Microphone:{" "}
                  {permissionLabels[entry.permissions.microphone]}
                </p>
                {entries.some(
                  (other) => other.origin === entry.origin && other.profile !== entry.profile,
                ) ? (
                  <p className="mt-1 text-xs text-cream-muted">
                    Browser profile{" "}
                    {entries.findIndex((other) => other.profile === entry.profile) + 1}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                className="shrink-0 rounded-md border border-charcoal-border px-3 py-1.5 text-xs hover:bg-charcoal-hover disabled:opacity-50"
                disabled={busy}
                aria-label={`Reset permissions for ${entry.origin}`}
                onClick={() => void reset(entry)}
              >
                Reset
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div role="alert" className="px-5 py-3 text-sm">
          <p>{error}</p>
          <Button
            type="button"
            className="mt-2 underline"
            disabled={busy}
            onClick={() => void load()}
          >
            Try again
          </Button>
        </div>
      ) : null}
    </DesktopSettingsSection>
  );
}
