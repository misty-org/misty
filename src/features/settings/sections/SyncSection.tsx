import { useEffect, useState } from "react";
import { Button, SkeletonList } from "@/shared/ui";
import {
  refreshVaultState,
  useVaultState,
  vaultNative,
  VaultPasswordDialog,
  type VaultPasswordMode,
  type VaultState,
} from "@/features/vault";
import {
  DesktopSettingsNotice as Notice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { DestroyVaultDialog } from "./sync/DestroyVaultDialog";
import { SyncSessions } from "./sync/SyncSessions";
import { SyncStorage } from "./sync/SyncStorage";

function statusText(vault: VaultState): string {
  if (vault.state === "paused") return "Paused";
  if (vault.state === "off") {
    if (vault.exists === null) return "Waiting for a connection";
    return vault.exists ? "Off on this computer" : "Not set up";
  }
  const { sending, receiving, connected, notice } = vault.status;
  if (!connected) return "Waiting for a connection";
  if (notice === "storage_full") return "Out of sync storage";
  if (sending || receiving) {
    const parts = [
      sending ? `${sending.toLocaleString()} to send` : "",
      receiving ? `${receiving.toLocaleString()} to receive` : "",
    ];
    return `Syncing, ${parts.filter(Boolean).join(" and ")}`;
  }
  return "Up to date";
}

function failure(cause: unknown): string {
  return typeof cause === "string" ? cause : "That didn't work. Try again.";
}

/** Start, pause and destroy; how far along sync is; how much it uses; who's signed in. */
export function SyncSection() {
  const vault = useVaultState((state) => state.vault);
  const [dialog, setDialog] = useState<VaultPasswordMode | null>(null);
  const [destroying, setDestroying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => void refreshVaultState(), []);

  if (!vault)
    return (
      <Section title="Setup">
        <SkeletonList label="Sync" rows={3} leading="none" trailing />
      </Section>
    );

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    void work()
      .then(refreshVaultState)
      .catch((cause: unknown) => setError(failure(cause)))
      .finally(() => setBusy(false));
  };
  const hasVault = vault.state !== "off" || vault.exists === true;
  const open = vault.state === "on";

  return (
    <>
      {error ? <Notice>{error}</Notice> : null}
      <Section title="Setup">
        <Row label="Status" description={statusText(vault)}>
          {vault.state === "on" ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(vaultNative.pause)}>
              Pause
            </Button>
          ) : vault.state === "paused" ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(vaultNative.start)}>
              Start
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={busy || vault.exists === null}
              onClick={() => setDialog(vault.exists ? "unlock" : "create")}
            >
              Start
            </Button>
          )}
        </Row>
      </Section>
      {open ? (
        <SyncStorage version={vault.status.synced_at} connected={vault.status.connected} />
      ) : null}
      {open ? (
        <SyncSessions thisSession={vault.session_id} connected={vault.status.connected} />
      ) : null}
      {hasVault ? (
        <Section title="Vault">
          {open ? (
            <Row label="Sync password">
              <Button variant="secondary" onClick={() => setDialog("change")}>
                Change password
              </Button>
            </Row>
          ) : null}
          <Row label="Destroy vault">
            <Button variant="secondary" onClick={() => setDestroying(true)}>
              Destroy
            </Button>
          </Row>
        </Section>
      ) : null}
      <VaultPasswordDialog
        mode={dialog ?? "create"}
        open={dialog !== null}
        dismissLabel="Cancel"
        onDismiss={() => setDialog(null)}
        onDone={() => setDialog(null)}
      />
      <DestroyVaultDialog open={destroying} onOpenChange={setDestroying} />
    </>
  );
}
