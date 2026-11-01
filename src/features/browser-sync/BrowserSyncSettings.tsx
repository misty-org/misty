import { useState } from "react";
import { useAuth } from "@/features/auth";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  SyncRestoreSettings,
} from "@/features/settings/desktop";
import { ChoiceControl, stringSetting } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settingsTypes";
import { ResetSyncRow, SyncAccountSettings } from "./SyncAccountSettings";
import { SyncStatusView } from "./SyncStatusView";
import { useSyncController, type SyncController } from "./useSyncController";
import { DeviceWebsiteDataList } from "./DeviceWebsiteDataList";
import { deviceRows, publishingDeviceId } from "./deviceControl";
import { SyncDeviceList } from "./SyncDeviceList";
import { SignedOutSyncSettings } from "./SignedOutSyncSettings";

/**
 * Settings › Sync. Before sync is set up the page opens its setup wizard; once this device has a
 * sync session the page lists the settings and devices, and Open setup re-runs the wizard to
 * reconnect or change the vault.
 */
export function BrowserSyncSettings(props: SettingsContentProps) {
  const { user } = useAuth();
  // Sync needs an account; signed out the page offers one instead.
  if (!user) return <SignedOutSyncSettings />;
  return <AccountSyncSettings {...props} />;
}

function AccountSyncSettings(props: SettingsContentProps) {
  const { user } = useAuth();
  const controller = useSyncController(user?.id ?? "");
  const session = controller.session;
  // Set up means this device holds a sync session for the account. Only a page opened before
  // that starts in the wizard; a session that ends later never pops it open on its own.
  const [open, setOpen] = useState(() => !session);
  return (
    <>
      <Section title="Sync">
        <Row
          label={session ? "Sync is on" : "Connect this device"}
          description={
            session ? "Reconnect this device or change its vault." : "End-to-end encrypted."
          }
        >
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {session ? "Open setup" : "Set up sync"}
          </Button>
        </Row>
        {session ? (
          <Row label="Sync frequency" description="Less often saves network and battery.">
            <ChoiceControl
              value={stringSetting(props.document, "sync", "sync_frequency", "balanced")}
              disabled={props.working}
              options={[
                { value: "live", label: "Live" },
                { value: "balanced", label: "Balanced" },
                { value: "saver", label: "Less often" },
              ]}
              onValueChange={(value) => props.onSettingChange("sync", "sync_frequency", value)}
            />
          </Row>
        ) : null}
      </Section>
      {session ? <SyncedSettings {...props} controller={controller} /> : null}
      <SyncSetupDialog controller={controller} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** What a set-up device manages on the page: restore, devices, sign-ins and recovery. */
function SyncedSettings(props: SettingsContentProps & { controller: SyncController }) {
  const { user } = useAuth();
  const { controller } = props;
  const session = controller.session!;
  const publisherId = publishingDeviceId(session);
  const publisher = deviceRows(session, user?.username).find(
    (device) => device.device_id === publisherId,
  );
  const canResetVault = Boolean(
    controller.accountId &&
    controller.desktop &&
    !controller.reenroll &&
    controller.vault &&
    (controller.vault.local || controller.vault.remote === true),
  );
  return (
    <>
      <SyncRestoreSettings {...props} />
      <Section title="Workspace devices">
        <SyncDeviceList key={session.session_id} session={session} />
      </Section>
      <Section
        title="Website sign-ins"
        description="Some sites may ask you to sign in again on another device."
      >
        <Row label="Publishing from">
          <span className="text-sm text-cream-muted">
            {session.supports_cookie_handoff === false
              ? "Not supported on this device"
              : (publisher?.name ?? "Waiting for a publishing device")}
          </span>
        </Row>
        <DeviceWebsiteDataList session={session} />
      </Section>
      {canResetVault ? (
        <Section title="Recovery">
          <ResetSyncRow controller={controller} />
        </Section>
      ) : null}
    </>
  );
}

/** The setup wizard: unlock, create or reconnect this device's vault. */
function SyncSetupDialog(props: {
  controller: SyncController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { controller } = props;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>Sync</DialogTitle>
          <DialogDescription>
            {controller.session ? "This device is connected." : "Connect this device."}
          </DialogDescription>
        </DialogHeader>
        <div
          data-settings-scroller
          className="misty-scrollbar max-h-[min(62dvh,620px)] overflow-y-auto px-6 pb-4"
        >
          {controller.status.title !== "Set up sync" ? (
            <SyncStatusView
              status={controller.status}
              busy={controller.busy}
              onAction={() => void controller.retry()}
            />
          ) : null}
          <div className="pt-2">
            {/* A locked vault is reset from here: with no way in, there is nothing else to show. */}
            <SyncAccountSettings controller={controller} showDelete={!controller.session} compact />
          </div>
        </div>
        <DialogFooter className="px-6 pb-5 pt-2">
          <Button onClick={() => props.onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
