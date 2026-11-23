import { useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { downloadsGrantId, sandboxPermissionSet, sandboxPermissionsList } from "@/native/sandbox";
import { confirmAction } from "@/shared/lib/confirm_action";
import { Button, ErrorState, useNotice } from "@misty/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { SwitchControl } from "../../settings/SettingsControls";

export function SandboxPermissionsSection() {
  const listing = useCachedResource("agents/sandbox-permissions", sandboxPermissionsList, {
    persist: "device",
  });
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
  if (loadFailed)
    return (
      <Section title="This computer">
        <ErrorState
          inline
          title="Couldn't read these permissions"
          line="Something went wrong on this computer. Try again in a moment."
          action={{ label: "Try again", onClick: () => void refresh() }}
        />
      </Section>
    );
  if (rows === null)
    return (
      <Section title="This computer">
        <DesktopSettingsRowSkeleton label="This computer" rows={3} control="switch" />
      </Section>
    );
  return (
    <Section title="This computer">
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
    </Section>
  );
}
