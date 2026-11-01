import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  ChoiceControl,
  FilePathControl,
  stringSetting,
  SwitchControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { DefaultBrowserRow } from "./DefaultBrowserRow";

type BrowserSettingsProps = Pick<SettingsContentProps, "document" | "working" | "onSettingChange">;

/** General › Browsing: the default browser, where outside links open and search suggestions.
 * The search engine has no row while the engine table lists only Google. */
export function BrowserLinksSettings(props: BrowserSettingsProps) {
  return (
    <SettingsSectionBlock title="Browsing">
      <DefaultBrowserRow />
      <SettingsRow
        label="Links from other apps"
        description="Peek opens a link over the current page."
      >
        <ChoiceControl
          value={stringSetting(props.document, "general", "browser_external_links", "tab")}
          options={[
            { value: "tab", label: "New tab" },
            { value: "peek", label: "Peek" },
          ]}
          disabled={props.working}
          onValueChange={(value) =>
            props.onSettingChange("general", "browser_external_links", value)
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Show search suggestions"
        description="Sends what you type to your search engine."
      >
        <SwitchControl
          checked={booleanSetting(props.document, "general", "browser_search_suggestions", false)}
          disabled={props.working}
          onChange={(value) =>
            props.onSettingChange("general", "browser_search_suggestions", value)
          }
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}

/** General › Downloads: where files from websites are saved. */
export function DownloadsSettings(props: BrowserSettingsProps) {
  return (
    <SettingsSectionBlock title="Downloads">
      <SettingsRow label="Download location">
        <FilePathControl
          directory
          title="Choose a download folder"
          value={stringSetting(props.document, "general", "browser_download_directory", "")}
          emptyLabel="Downloads"
          disabled={props.working}
          onChange={(value) =>
            props.onSettingChange("general", "browser_download_directory", value)
          }
        />
      </SettingsRow>
      <SettingsRow label="Ask where to save each file">
        <SwitchControl
          checked={booleanSetting(props.document, "general", "browser_download_prompt", false)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "browser_download_prompt", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
