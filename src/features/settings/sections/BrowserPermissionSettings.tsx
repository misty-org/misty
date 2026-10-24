import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "../components/DesktopSettingsUI";
import { Button, SkeletonList } from "@/shared/ui";
import {
  permissionLabels,
  supportsSitePermissions,
  type SavedSitePermission,
} from "@/features/browser-sync/sitePermissions";

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
    } catch {
      setError("Site permissions could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);
  if (!supported) return null;
  if (!loading && !error && entries.length === 0) return null;
  const reset = async (entry: SavedSitePermission) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("browser_site_permissions_reset", {
        profile: entry.profile,
        origin: entry.origin,
      });
      await load();
    } catch {
      // Reset may have persisted before native capture shutdown failed.
      await load();
      setError("Site permissions could not be reset. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DesktopSettingsSection
      title="Website permissions"
      description={
        "Saved choices for the Spaces open now; each Space keeps its own. Websites ask before " +
        "using your camera or microphone. Change a site's choices from the information button " +
        "beside its address. Resetting stops capture in that Space."
      }
    >
      {loading ? (
        <SkeletonList
          label="Website permissions"
          rows={3}
          leading="none"
          trailing
          className="gap-4"
          rowClassName="py-3"
        />
      ) : (
        <ul className="grid">
          {entries.map((entry) => (
            <li key={`${entry.profile}:${entry.origin}`}>
              <DesktopSettingsRow
                label={entry.origin}
                description={
                  <>
                    Camera: {permissionLabels[entry.permissions.camera]} · Microphone:{" "}
                    {permissionLabels[entry.permissions.microphone]}
                    {new Set(entries.map((other) => other.space)).size > 1
                      ? ` · ${entry.space}`
                      : ""}
                  </>
                }
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-label={`Reset permissions for ${entry.origin}`}
                  onClick={() => void reset(entry)}
                >
                  Reset
                </Button>
              </DesktopSettingsRow>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <DesktopSettingsNotice
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void load()}
            >
              Try again
            </Button>
          }
        >
          {error}
        </DesktopSettingsNotice>
      ) : null}
    </DesktopSettingsSection>
  );
}
