import { Button } from "@/shared/ui";
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
  compact,
  sectionTitle,
}: {
  controller: SyncController;
  compact?: boolean;
  sectionTitle?: string;
}) {
  const { vault, reenroll, unlock } = controller;
  if (!vault) return <p className="text-sm text-cream-muted">Checking your sync vault…</p>;
  return (
    <SyncVaultForm
      compact={compact}
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
        <div className="p-5">
          <SyncUnlockForm controller={controller} />
        </div>
      )}
    </Section>
  );
}
