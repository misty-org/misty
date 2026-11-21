import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { notify } from "@misty/ui";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { useEffect, useState } from "react";
import { DropdownControl, SwitchControl } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settingsTypes";
import { driveNative } from "./driveNative";

const GB = 1024 * 1024 * 1024;
const choices = [
  { value: "1", label: "1 GB" },
  { value: "5", label: "5 GB" },
  { value: "20", label: "20 GB" },
  { value: "none", label: "No limit" },
];

/** The cache size the person picked, kept for the device; native code applies and keeps the limit. */
const savedCacheChoice = createDeviceSetting<string>({
  scope: "drive-cache-choice",
  defaults: "none",
  normalize: (stored) =>
    typeof stored === "string" && choices.some((item) => item.value === stored) ? stored : "none",
});

/** Settings › Server › Drive: how much of the Spaces' files this computer keeps downloaded. */
export function DriveSettingsSection(props: SettingsContentProps) {
  const chosen = savedCacheChoice((state) => state.value);
  const [paused, setPaused] = useState<boolean | null>(null);
  useEffect(() => {
    driveNative
      .paused()
      .then(setPaused)
      .catch(() => setPaused(null));
  }, []);
  return (
    <SettingsSectionBlock title="Drive">
      <SettingsRow
        label="Pause syncing"
        description="Changes wait on this computer until you turn it back on or restart Misty."
      >
        <SwitchControl
          checked={paused === true}
          disabled={props.working || paused === null}
          onChange={(value) =>
            driveNative
              .setPaused(value)
              .then(setPaused)
              .catch(() => notify({ message: "Syncing couldn't be changed. Try again.", tone: "error" }))
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Keep up to"
        description="Files past this are removed from this computer and come back when opened."
      >
        <DropdownControl
          value={chosen}
          options={choices}
          disabled={props.working}
          onValueChange={(value) => {
            const bytes = value === "none" ? null : Number(value) * GB;
            driveNative
              .setCacheLimit(bytes)
              .then(() => savedCacheChoice.getState().set(value))
              .catch(() => notify({ message: "The drive's limit couldn't be changed. Try again.", tone: "error" }));
          }}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
