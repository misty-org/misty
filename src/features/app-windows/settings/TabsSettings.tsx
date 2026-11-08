import { defaultBrowserHomeUrl, normalizeBrowserHomeUrl } from "../addresses/browserHome";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import {
  ChoiceControl,
  numberSetting,
  stringSetting,
  TextControl,
} from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

type TabsSettingsProps = Pick<SettingsContentProps, "document" | "working" | "onSettingChange">;

const archiveOptions = [
  { value: "0", label: "Never" },
  { value: "12", label: "After 12 hours" },
  { value: "24", label: "After 1 day" },
  { value: "168", label: "After 1 week" },
  { value: "720", label: "After 30 days" },
];

/** General › Tabs: what a new tab opens to and when idle tabs close. Sleeping hidden tabs is
 * under Advanced. */
export function TabsSettings(props: TabsSettingsProps) {
  return (
    <SettingsSectionBlock title="Tabs">
      <SettingsRow label="Homepage" description="Where new tabs open.">
        <TextControl
          value={stringSetting(props.document, "general", "browser_homepage", "")}
          placeholder={defaultBrowserHomeUrl}
          disabled={props.working}
          onCommit={(value) =>
            props.onSettingChange(
              "general",
              "browser_homepage",
              value.trim() ? normalizeBrowserHomeUrl(value) : "",
            )
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Archive idle tabs"
        description="Pinned, grouped and playing tabs stay. Find the rest in History."
      >
        <ChoiceControl
          value={String(numberSetting(props.document, "general", "browser_auto_archive_hours", 0))}
          options={archiveOptions}
          disabled={props.working}
          onValueChange={(value) =>
            props.onSettingChange("general", "browser_auto_archive_hours", Number(value))
          }
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
