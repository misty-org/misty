import { useEffect, useState } from "react";
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
import { useSyncController } from "./useSyncController";
import { DeviceWebsiteDataList } from "./DeviceWebsiteDataList";
import { deviceRows, publishingDeviceId } from "./deviceControl";
import { SyncDeviceList } from "./SyncDeviceList";
import { SignedOutSyncSettings } from "./SignedOutSyncSettings";

/** Sync opens as a short wizard; the settings list keeps only its entry point. */
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
  const publisherId = session ? publishingDeviceId(session) : null;
  const publisher =
    session &&
    deviceRows(session, user?.username).find((device) => device.device_id === publisherId);
  const canResetVault = Boolean(
    controller.accountId &&
    controller.desktop &&
    !controller.reenroll &&
    controller.vault &&
    (controller.vault.local || controller.vault.remote === true),
  );
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);

  useEffect(() => {
    setOpen(true);
  }, []);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) setStep(0);
  };

  return (
    <>
      <Section title="Sync">
        <Row
          label={controller.session ? "Sync is connected" : "Connect this device"}
          description="Set up or manage encrypted sync in a separate flow."
        >
          <Button variant="outline" onClick={() => changeOpen(true)}>
            Open sync wizard
          </Button>
        </Row>
      </Section>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="px-6 pb-4 pt-6">
            <DialogTitle>Sync</DialogTitle>
            <DialogDescription>
              Step {step + 1} of 2 · {step === 0 ? "Connect this device" : "Manage sync"}
            </DialogDescription>
          </DialogHeader>
          <div
            data-settings-scroller
            className="misty-scrollbar max-h-[min(62dvh,620px)] overflow-y-auto px-6 pb-4"
          >
            {step === 0 ? (
              <>
                {controller.status.title !== "Set up sync" ? (
                  <SyncStatusView
                    status={controller.status}
                    busy={controller.busy}
                    onAction={() => void controller.retry()}
                  />
                ) : null}
                <div className="pt-2">
                  {/* A locked vault is reset from here: with no way in, there is no second step. */}
                  <SyncAccountSettings
                    controller={controller}
                    showDelete={!controller.session}
                    compact
                  />
                </div>
              </>
            ) : session ? (
              <>
                <Section
                  title="Timing"
                  description="Choose how quickly changes are sent and how often Misty checks for updates."
                  density="compact"
                >
                  <Row
                    label="Sync frequency"
                    description="Live sends changes promptly; Less often reduces network activity."
                    density="compact"
                  >
                    <ChoiceControl
                      value={stringSetting(props.document, "sync", "sync_frequency", "balanced")}
                      disabled={props.working}
                      options={[
                        { value: "live", label: "Live" },
                        { value: "balanced", label: "Balanced" },
                        { value: "saver", label: "Less often" },
                      ]}
                      onValueChange={(value) =>
                        props.onSettingChange("sync", "sync_frequency", value)
                      }
                    />
                  </Row>
                </Section>
                <SyncRestoreSettings {...props} compact />
                <Section
                  title="Workspace devices"
                  description="Devices connected to this workspace."
                  density="compact"
                >
                  <SyncDeviceList key={session.session_id} session={session} />
                </Section>
                <Section
                  title="Website sign-ins"
                  description="Sync cookies and sign-in keys so websites can recognize you on another device. Some sites may ask you to sign in again."
                  density="compact"
                >
                  <Row
                    label="Publishing from"
                    description="The device currently sharing website sign-ins for this workspace."
                    density="compact"
                  >
                    <span className="text-sm text-cream-muted">
                      {session.supports_cookie_handoff === false
                        ? "Not supported on this device"
                        : (publisher?.name ?? "Waiting for a publishing device")}
                    </span>
                  </Row>
                  <DeviceWebsiteDataList session={session} />
                </Section>
                {canResetVault ? (
                  <Section title="Recovery" density="compact">
                    <ResetSyncRow controller={controller} />
                  </Section>
                ) : null}
              </>
            ) : (
              <SyncStatusView
                status={controller.status}
                busy={controller.busy}
                onAction={() => void controller.retry()}
              />
            )}
          </div>
          <DialogFooter className="px-6 pb-5 pt-2">
            {step === 1 ? (
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
            ) : null}
            {step === 0 ? (
              <Button disabled={!controller.session} onClick={() => setStep(1)}>
                Continue
              </Button>
            ) : (
              <Button onClick={() => setOpen(false)}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
