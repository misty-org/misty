import {
  nativeNotificationPermission,
  requestNativeNotificationPermission,
  type NativeNotificationPermission,
} from "@/features/activity";
import { notificationsDeviceKey } from "../store/preferences";
import { Switch } from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSection,
} from "./DesktopSettingsUI";

interface NotificationSettingsProps {
  document: Record<string, unknown>;
  working: boolean;
  onSettingChange: (section: string, key: string, value: boolean) => void;
}

export function NotificationSettings(props: NotificationSettingsProps) {
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
      <SettingsSection title="Delivery">
        <SettingsRow
          label="Desktop notifications"
          description={
            permission === "denied"
              ? "Blocked by macOS. Allow Misty in System Settings to receive banners."
              : "Show a native notification when Misty is running in the background."
          }
        >
          <Switch
            checked={desktopEnabled && permission === "granted"}
            disabled={props.working || permission === "unsupported"}
            onCheckedChange={(value) => void setDesktopEnabled(value)}
          />
        </SettingsRow>
        <SettingsRow
          label="In-app notifications"
          description="Show lightweight feedback inside Misty while you work."
        >
          <PreferenceSwitch {...props} setting="in_app_notifications_enabled" fallback />
        </SettingsRow>
        <SettingsRow
          label="Badge count"
          description="Show contextual counts in Misty and an attention count in the Dock."
          last
        >
          <PreferenceSwitch {...props} setting="badge_count_enabled" fallback />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Attention">
        <SettingsRow
          label="Notification sound"
          description="Play a system sound with background desktop notifications."
        >
          <PreferenceSwitch
            {...props}
            setting="sound_notifications_enabled"
            disabled={!desktopEnabled}
          />
        </SettingsRow>
        <SettingsRow
          label="Quiet hours"
          description="Keep contextual counts without banners or sounds."
        >
          <PreferenceSwitch {...props} setting="quiet_hours_enabled" />
        </SettingsRow>
        <SettingsRow
          label="Digest mode"
          description="Collect routine updates without immediate banners."
          last
        >
          <PreferenceSwitch {...props} setting="digest_notifications_enabled" />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function PreferenceSwitch(
  props: NotificationSettingsProps & {
    setting: string;
    fallback?: boolean;
    disabled?: boolean;
  },
) {
  return (
    <Switch
      checked={booleanSetting(
        props.document,
        "notifications",
        props.setting,
        props.fallback ?? false,
      )}
      disabled={props.working || props.disabled}
      onCheckedChange={(value) => props.onSettingChange("notifications", props.setting, value)}
    />
  );
}

function booleanSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: boolean,
): boolean {
  const sectionValue = document[section];
  if (!sectionValue || typeof sectionValue !== "object" || Array.isArray(sectionValue)) {
    return fallback;
  }
  const value = (sectionValue as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : fallback;
}
