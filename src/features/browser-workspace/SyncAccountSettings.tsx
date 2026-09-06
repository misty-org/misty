import { Button, cn, Skeleton } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "@/features/settings/desktop";
import { SettingsNote } from "@/features/settings/SettingsControls";
import { SyncVaultForm } from "./SyncVaultForm";
import { generateSyncSecret } from "./native";
import type { SyncController } from "./useSyncController";
export function SyncUnlockForm({
  controller,
  sectionTitle,
}: {
  controller: SyncController;
  sectionTitle?: string;
}) {
  const { vault, reenroll, unlock } = controller;
  if (!vault) return <SyncVaultFormSkeleton />;
  return (
    <SyncVaultForm
      sectionTitle={sectionTitle}
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
            "border-t border-charcoal-border py-3 @max-[560px]/settings:grid-cols-1",
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
      <div className="flex justify-end border-t border-charcoal-border py-3">
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  );
}
export function SyncAccountSettings({ controller }: { controller: SyncController }) {
  if (controller.accountId && controller.desktop && !controller.session && controller.vault)
    return <SyncUnlockForm controller={controller} sectionTitle="Sync account" />;
  return (
    <Section title="Sync account">
      {!controller.accountId ? (
        <SettingsNote>Sign in to Misty to manage your sync vault.</SettingsNote>
      ) : !controller.desktop ? (
        <SettingsNote>Open the Misty desktop app to manage your encrypted sync vault.</SettingsNote>
      ) : controller.session ? (
        <>
          <Row
            label="Sync vault"
            description="Workspace content is encrypted on this device before upload."
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
            description="Forget the saved key to require your sync password and secret next time."
          >
            <Button
              variant="outline"
              disabled={controller.busy || !controller.vault?.local}
              onClick={() => void controller.lock(true)}
            >
              Forget key
            </Button>
          </Row>
        </>
      ) : (
        <div className="border-t border-charcoal-border pt-3">
          <SyncUnlockForm controller={controller} />
        </div>
      )}
    </Section>
  );
}
