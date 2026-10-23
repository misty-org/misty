import { useState } from "react";
import { Button, cn, Skeleton } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "@/features/settings/desktop";
import { SettingsNote } from "@/features/settings/SettingsControls";
import { SyncDeleteVaultDialog } from "./SyncDeleteVaultDialog";
import { SyncVaultForm } from "./SyncVaultForm";
import { generateSyncSecret } from "./native";
import type { SyncController } from "./useSyncController";
export function SyncUnlockForm({
  controller,
  sectionTitle,
  compact = false,
}: {
  controller: SyncController;
  sectionTitle?: string;
  compact?: boolean;
}) {
  const { vault, reenroll, unlock } = controller;
  if (!vault) return <SyncVaultFormSkeleton />;
  return (
    <SyncVaultForm
      sectionTitle={sectionTitle}
      compact={compact}
      key={`${vault.account.accountId}:${vault.generation}:${reenroll}`}
      local={vault.local}
      create={!reenroll && !vault.local && vault.remote === false}
      reenroll={reenroll}
      onGenerateSecret={generateSyncSecret}
      onUnlock={unlock}
    />
  );
}
/** Mirrors the SyncVaultForm layout: a section header, hairline rows and the action footer. */
function SyncVaultFormSkeleton() {
  const rows = [
    { label: "w-28", description: false, control: "h-8 w-full max-w-[320px]" },
    { label: "w-24", description: true, control: "h-8 w-full max-w-[320px]" },
    { label: "w-40", description: true, control: "h-4 w-36" },
  ];
  return (
    <div
      role="status"
      aria-label="Sync vault"
      aria-busy="true"
      className="@container/settings mb-8 min-w-0 last:mb-0"
    >
      <span className="sr-only">Sync vault</span>
      <div className="mb-1.5 grid min-w-0 gap-1.5 py-0.5">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-2.5 w-full max-w-md" />
      </div>
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            "grid min-h-14 grid-cols-[minmax(0,1fr)_240px] items-center gap-x-6 gap-y-2.5",
            "py-3 @max-[560px]/settings:grid-cols-1",
          )}
        >
          <div className="grid min-w-0 gap-1.5">
            <Skeleton className={`h-3 ${row.label}`} />
            {row.description && <Skeleton className="h-2.5 w-2/3" />}
          </div>
          <div className="flex min-w-0 justify-end @max-[560px]/settings:justify-start">
            <Skeleton className={row.control} />
          </div>
        </div>
      ))}
      <div className="flex justify-end py-3">
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  );
}
/** An account has one vault at a time; deleting it is how a new one is created. */
function DeleteVaultRow({ controller }: { controller: SyncController }) {
  const [open, setOpen] = useState(false);
  const { vault } = controller;
  if (!vault || (!vault.local && vault.remote !== true)) return null;
  return (
    <Row
      label="Delete vault"
      description={
        "Removes synced data from the server and stops sync on every device, so you can " +
        "create a new vault. Use it if you lost your sync password or secret."
      }
    >
      <Button variant="outline" disabled={controller.busy} onClick={() => setOpen(true)}>
        Delete vault
      </Button>
      <SyncDeleteVaultDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={controller.deleteVault}
      />
    </Row>
  );
}

/** Lets a signed-in device replace a vault when its password or secret is lost. */
export function ResetSyncRow({ controller }: { controller: SyncController }) {
  const [open, setOpen] = useState(false);
  const { vault } = controller;
  if (!controller.accountId || !controller.desktop || controller.reenroll) return null;
  if (!vault || (!vault.local && vault.remote !== true)) return null;
  return (
    <Row
      label="Lost your sync password or secret?"
      description="Resetting removes synced data from the server and stops sync on every device. You can then set up sync again."
    >
      <Button variant="ghost" disabled={controller.busy} onClick={() => setOpen(true)}>
        Reset sync…
      </Button>
      <SyncDeleteVaultDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={controller.deleteVault}
      />
    </Row>
  );
}

export function SyncAccountSettings({
  controller,
  showDelete = true,
  compact = false,
}: {
  controller: SyncController;
  showDelete?: boolean;
  compact?: boolean;
}) {
  if (compact && (!controller.accountId || !controller.desktop)) return null;
  if (controller.accountId && controller.desktop && !controller.session)
    return (
      <>
        <SyncUnlockForm controller={controller} compact={compact} />
        {!controller.reenroll &&
        showDelete &&
        controller.vault &&
        (controller.vault.local || controller.vault.remote === true) ? (
          <Section title="Recovery" density={compact ? "compact" : "normal"}>
            <DeleteVaultRow controller={controller} />
          </Section>
        ) : null}
      </>
    );
  return (
    <Section
      title={compact ? "Vault access" : "Sync account"}
      density={compact ? "compact" : "normal"}
    >
      {!controller.accountId ? (
        <SettingsNote>Sign in to Misty to manage your sync vault.</SettingsNote>
      ) : !controller.desktop ? (
        <SettingsNote>Open the Misty desktop app to manage your encrypted sync vault.</SettingsNote>
      ) : controller.session ? (
        <>
          <Row
            label="Sync vault"
            description="Encrypted on this device before upload."
            density={compact ? "compact" : "normal"}
          >
            <Button
              variant="outline"
              disabled={controller.busy}
              onClick={() => void controller.lock(false)}
            >
              Lock sync
            </Button>
          </Row>
          <Row
            label="Saved device key"
            description="Forget it to require your password and secret next time."
            density={compact ? "compact" : "normal"}
          >
            <Button
              variant="outline"
              disabled={controller.busy || !controller.vault?.local}
              onClick={() => void controller.lock(true)}
            >
              Forget key
            </Button>
          </Row>
          {showDelete ? <DeleteVaultRow controller={controller} /> : null}
        </>
      ) : (
        <div className="pt-3">
          <SyncUnlockForm controller={controller} compact={compact} />
        </div>
      )}
    </Section>
  );
}
