import { useEffect, useRef } from "react";
import { useAuth } from "@/features/auth";
import {
  DesktopSettingsSection as Section,
  DesktopSettingsRow as Row,
} from "@/features/settings/desktop";
import { SettingsNote } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settingsTypes";
import { SettingsSyncSection, SyncRestoreSettings } from "@/features/settings/syncSettings";
import { DeviceWebsiteDataList } from "./DeviceWebsiteDataList";
import { deviceRows, publishingDeviceId } from "./deviceControl";
import { SyncDeviceList } from "./SyncDeviceList";
import { SyncStatusView } from "./SyncStatusView";
import { SyncAccountSettings } from "./SyncAccountSettings";
import { useSyncController } from "./useSyncController";

export function BrowserSyncSettings(props: SettingsContentProps) {
  const { user } = useAuth();
  const controller = useSyncController(user?.id ?? "");
  const { session } = controller;
  const accountSection = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controller.form) return;
    accountSection.current?.scrollIntoView?.({ block: "start" });
    accountSection.current
      ?.querySelector<HTMLInputElement>('input[aria-label="Sync password"]')
      ?.focus();
  }, [controller.form]);
  // The actual active publisher is distinct from the workspace being viewed.
  const publisherId = session ? publishingDeviceId(session) : null;
  const publisher =
    session && deviceRows(session, user?.name).find((d) => d.device_id === publisherId);
  return (
    <>
      <Section title="Overview">
        <div className="border-t border-charcoal-border py-3">
          <SyncStatusView
            status={controller.status}
            busy={controller.busy}
            onAction={() => void controller.retry()}
          />
        </div>
      </Section>
      <Section title="Workspace devices">
        {session ? (
          <SyncDeviceList key={session.session_id} session={session} />
        ) : (
          <SettingsNote>
            {controller.desktop
              ? "Devices appear when this workspace is connected to sync."
              : "Open the Misty desktop app to sync workspace devices."}
          </SettingsNote>
        )}
      </Section>
      <Section title="Website sign-ins">
        <SettingsNote>
          Sync cookies and sign-in keys so websites can recognize you on another device. Some
          websites may ask you to sign in again.
        </SettingsNote>
        <Row
          label="Publishing from"
          description="The machine currently publishing website sign-ins."
        >
          <span className="text-sm text-cream-muted">
            {session?.supports_cookie_handoff === false
              ? "Not supported on this device"
              : (publisher?.name ?? "Waiting for a publishing device")}
          </span>
        </Row>
        {session && <DeviceWebsiteDataList session={session} />}
      </Section>
      <SyncRestoreSettings {...props} />
      <SettingsSyncSection showStatus={false} />
      <div ref={accountSection}>
        <SyncAccountSettings controller={controller} />
      </div>
    </>
  );
}
