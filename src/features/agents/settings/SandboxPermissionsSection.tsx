import { useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { downloadsGrantId, sandboxPermissionSet, sandboxPermissionsList } from "@/native/sandbox";
import { confirmAction } from "@/shared/lib/confirm_action";
import { Button, ErrorState, useNotice } from "@misty/ui";
import { DesktopSettingsRow as Row, DesktopSettingsRowSkeleton } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { SwitchControl } from "../../settings/SettingsControls";

export function SandboxPermissionsSection() {
  const native = hasTauriInternals();
  const listing = useCachedResource(
    native ? "agents/sandbox-permissions" : null,
    sandboxPermissionsList,
    { persist: "device" },
  );
  const rows = listing.data ?? null;
  const loadFailed = !listing.data && !listing.loading && Boolean(listing.error);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const refresh = listing.reload;
  const change = async (id: string, on: boolean) => {
    setWorking(id);
    setError("");
    try {
      await sandboxPermissionSet(id, on);
      await refresh();
    } catch {
      setError("That couldn’t be changed. Try again.");
    } finally {
      setWorking("");
    }
  };
  const revokeDownloads = async () => {
    if (
      await confirmAction(
        "Stop saving to your Downloads folder? Misty asks again on your next download. Files already there stay.",
        "Revoke",
      )
    )
      await change(downloadsGrantId, false);
  };
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  if (!native) return null;
  if (loadFailed)
    return (
      <ErrorState
        inline
        title="Couldn't read these permissions"
        line="Something went wrong on this computer. Try again in a moment."
        action={{ label: "Try again", onClick: () => void refresh() }}
      />
    );
  if (rows === null)
    return <DesktopSettingsRowSkeleton label="Sandbox" rows={3} control="switch" />;
  return (
    <>
      {rows
        .filter((row) => row.id !== downloadsGrantId || row.on)
        .map((row) =>
          row.id === downloadsGrantId ? (
            <Row key={row.id} label={row.label}>
              <Button disabled={working !== ""} onClick={() => void revokeDownloads()}>
                Revoke
              </Button>
            </Row>
          ) : (
            <Row key={row.id} label={row.label}>
              <SwitchControl
                checked={row.on}
                disabled={working !== ""}
                onChange={(on) => void change(row.id, on)}
              />
            </Row>
          ),
        )}
    </>
  );
}
