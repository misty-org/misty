import { DesktopSettingsRow as SettingsRow } from "@/features/settings";
import { notify } from "@misty/ui";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { useEffect, useState } from "react";
import { DropdownControl, SwitchControl } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settings_types";
import { driveNative } from "./drive_native";

const GB = 1024 * 1024 * 1024;
const choices = [
  { value: "1", label: "1 GB" },
  { value: "5", label: "5 GB" },
  { value: "20", label: "20 GB" },
  { value: "none", label: "No limit" },
];

const MB = 1024 * 1024;
const largeChoices = [
  { value: "100", label: "100 MB" },
  { value: "500", label: "500 MB" },
  { value: "1024", label: "1 GB" },
  { value: "5120", label: "5 GB" },
  { value: "none", label: "No limit" },
];

const useSavedLargeChoice = createDeviceSetting<string>({
  scope: "drive-large-file-choice",
  defaults: "1024",
  normalize: (stored) =>
    typeof stored === "string" && largeChoices.some((item) => item.value === stored)
      ? stored
      : "1024",
});

const useSavedCacheChoice = createDeviceSetting<string>({
  scope: "drive-cache-choice",
  defaults: "none",
  normalize: (stored) =>
    typeof stored === "string" && choices.some((item) => item.value === stored) ? stored : "none",
});

export function DriveSettingsSection(props: SettingsContentProps) {
  const chosen = useSavedCacheChoice((state) => state.value);
  const large = useSavedLargeChoice((state) => state.value);
  const [paused, setPaused] = useState<boolean | null>(null);
  useEffect(() => {
    driveNative
      .paused()
      .then(setPaused)
      .catch(() => setPaused(null));
  }, []);
  return (
    <>
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
              .catch(() =>
                notify({ message: "Syncing couldn't be changed. Try again.", tone: "error" }),
              )
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Ask before syncing files over"
        description="Larger files stay on this computer until you choose Sync this file in Files."
      >
        <DropdownControl
          value={large}
          options={largeChoices}
          disabled={props.working}
          onValueChange={(value) => {
            const bytes = value === "none" ? null : Number(value) * MB;
            driveNative
              .setLargeFileLimit(bytes)
              .then(() => useSavedLargeChoice.getState().set(value))
              .catch(() =>
                notify({
                  message: "The size couldn't be changed. Try again.",
                  tone: "error",
                }),
              );
          }}
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
              .then(() => useSavedCacheChoice.getState().set(value))
              .catch(() =>
                notify({
                  message: "The drive's limit couldn't be changed. Try again.",
                  tone: "error",
                }),
              );
          }}
        />
      </SettingsRow>
    </>
  );
}
