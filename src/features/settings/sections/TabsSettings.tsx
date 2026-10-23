import { defaultBrowserHomeUrl, normalizeBrowserHomeUrl } from "@/features/workspace";
import {
  workspaceDefaultViewIndex,
  workspaceDefaultViewOption,
  workspaceDefaultViewOptions,
  workspaceDefaultViewStoredIndex,
} from "@/features/workspace/workspaceDefaultView";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  ChoiceControl,
  numberSetting,
  SelectControl,
  stringSetting,
  TextControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

type TabsSettingsProps = Pick<SettingsContentProps, "document" | "working" | "onSettingChange">;

const archiveOptions = [
  { value: "0", label: "Never" },
  { value: "12", label: "After 12 hours" },
  { value: "24", label: "After 1 day" },
  { value: "168", label: "After 1 week" },
  { value: "720", label: "After 30 days" },
];

const sleepOptions = [
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "0", label: "Never" },
];

/** Browsing › Tabs: what a new tab opens to, and what tabs you aren't looking at cost. */
export function TabsSettings(props: TabsSettingsProps) {
  return (
    <SettingsSectionBlock title="Tabs">
      <SettingsRow
        label="New tabs and splits"
        description="Choose the starting page. Selecting a navbar destination fills an unused tab or pane."
      >
        <SelectControl
          value={workspaceDefaultViewOption(
            numberSetting(
              props.document,
              "general",
              "workspace_default_tab_index",
              workspaceDefaultViewIndex,
            ),
          )}
          options={[...workspaceDefaultViewOptions]}
          disabled={props.working}
          onChange={(value) =>
            props.onSettingChange(
              "general",
              "workspace_default_tab_index",
              workspaceDefaultViewStoredIndex(value),
            )
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Homepage"
        description={`Where new browser tabs open. Leave empty for ${defaultBrowserHomeUrl}.`}
      >
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
        label="Sleep hidden tabs"
        description={
          "A tab you switched away from stops drawing and running scripts after this long, and " +
          "wakes the moment you return. Tabs playing sound, sharing your screen, downloading or " +
          "used by an agent keep running."
        }
      >
        <ChoiceControl
          value={String(
            numberSetting(props.document, "general", "browser_hidden_tab_sleep_seconds", 0),
          )}
          options={sleepOptions}
          disabled={props.working}
          onValueChange={(value) =>
            props.onSettingChange("general", "browser_hidden_tab_sleep_seconds", Number(value))
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Archive idle tabs"
        description="Close tabs you haven't looked at for a while. Pinned, grouped and playing tabs stay. Find them in History under Archived."
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
