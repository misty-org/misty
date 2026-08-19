import {
  nativeNotificationPermission,
  requestNativeNotificationPermission,
  type NativeNotificationPermission,
} from "@/features/activity";
import { notificationsDeviceKey } from "../store/preferences";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function NotificationsSection(props: SettingsContentProps) {
  const [permission, setPermission] = useState<NativeNotificationPermission>("prompt");
  const desktopEnabled = booleanSetting(
    props.document,
    "notifications",
    notificationsDeviceKey,
    true,
  );

  useEffect(() => {
    void nativeNotificationPermission().then(setPermission);
  }, []);

  const setDesktopEnabled = async (enabled: boolean) => {
    if (!enabled) {
      props.onSettingChange("notifications", notificationsDeviceKey, false);
      return;
    }
    const nextPermission = await requestNativeNotificationPermission();
    setPermission(nextPermission);
    if (nextPermission === "granted") {
      props.onSettingChange("notifications", notificationsDeviceKey, true);
    }
  };

  return (
    <>
      <SettingsSectionBlock title="Delivery">
        <SettingsRow
          label="Desktop notifications"
          description={
            permission === "denied"
              ? "Blocked by macOS. Allow Misty in System Settings to receive banners."
              : "Show a native notification when Misty is running in the background."
          }
        >
          <SwitchControl
            checked={desktopEnabled && permission === "granted"}
            disabled={props.working || permission === "unsupported"}
            onChange={(value) => void setDesktopEnabled(value)}
          />
        </SettingsRow>
        <SettingsRow
          label="In-app notifications"
          description="Show lightweight feedback inside Misty while you work."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "in_app_notifications_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "in_app_notifications_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Badge count"
          description="Show contextual counts in Misty and an attention count in the Dock."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "badge_count_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "badge_count_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Attention">
        <SettingsRow
          label="Notification sound"
          description="Play a system sound with background desktop notifications."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "sound_notifications_enabled",
              false,
            )}
            disabled={props.working || !desktopEnabled}
            onChange={(value) =>
              props.onSettingChange("notifications", "sound_notifications_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Quiet hours"
          description="Keep contextual counts without banners or sounds."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "quiet_hours_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "quiet_hours_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Digest mode"
          description="Collect routine updates without immediate banners."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "digest_notifications_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "digest_notifications_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
