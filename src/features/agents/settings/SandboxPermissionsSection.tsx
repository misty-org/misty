import { useEffect, useState } from "react";
import {
  downloadsGrantId,
  sandboxPermissionSet,
  sandboxPermissionsList,
  type SandboxPermission,
} from "@/native/sandbox";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, useNotice, SkeletonList } from "@/shared/ui";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { SwitchControl } from "../../settings/SettingsControls";

/**
 * What Misty may reach on this computer. Each stays off until the person says yes the first time
 * it's needed, and can be changed here. These live on the device and never sync.
 */
export function SandboxPermissionsSection() {
  const [rows, setRows] = useState<SandboxPermission[] | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const refresh = () =>
    sandboxPermissionsList()
      .then(setRows)
      .catch(() => {
        setRows((current) => current ?? []);
        setError("Misty couldn’t load these permissions. Try again.");
      });
  useEffect(() => {
    void refresh();
  }, []);
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
  if (rows === null)
    return (
      <Section title="This computer">
        <SkeletonList lines={2} label="This computer" rows={5} leading="none" trailing />
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
