import {
  IDLE_MINUTE_CHOICES,
  KEEP_DAY_CHOICES,
  screenMemorySettings,
} from "@/features/screen-memory";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { ChoiceControl, TextAreaControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const minutesLabel = (minutes: number) => (minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`);

/** Settings › Memory › Screen capture: how a capture session you start behaves. */
export function ScreenCaptureSettings(props: SettingsContentProps) {
  const screen = screenMemorySettings(props.document);
  const set = (key: string, value: string | number) =>
    props.onSettingChange("screen_memory", key, value);
  return (
    <SettingsSectionBlock title="Screen capture">
      <SettingsRow label="Stop when I'm away" description="Ends a session after this long idle.">
        <ChoiceControl
          value={String(screen.idleMinutes)}
          options={IDLE_MINUTE_CHOICES.map((minutes) => ({
            value: String(minutes),
            label: minutesLabel(minutes),
          }))}
          disabled={props.working}
          onValueChange={(value) => set("idle_minutes", Number(value))}
        />
      </SettingsRow>
      <SettingsRow label="Keep screen memories">
        <ChoiceControl
          value={String(screen.keepDays)}
          options={KEEP_DAY_CHOICES.map((days) => ({ value: String(days), label: `${days} days` }))}
          disabled={props.working}
          onValueChange={(value) => set("keep_days", Number(value))}
        />
      </SettingsRow>
      <SettingsRow
        label="Apps capture skips"
        description="One per line. Password managers are always skipped."
        stacked
      >
        <TextAreaControl
          value={screen.excludedApps.join("\n")}
          placeholder={"Slack\nMessages"}
          rows={3}
          disabled={props.working}
          onCommit={(value) => set("excluded_apps", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
