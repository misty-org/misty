import { invoke } from "@/native/invoke";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import {
  booleanSetting,
  FilePathControl,
  stringSetting,
  SwitchControl,
} from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

type BrowserSettingsProps = Pick<SettingsContentProps, "document" | "working" | "onSettingChange">;

/** General › Downloads: where files from websites are saved. */
export function DownloadsSettings(props: BrowserSettingsProps) {
  return (
    <SettingsSectionBlock title="Downloads">
      <SettingsRow label="Download location">
        <FilePathControl
          directory
          title="Choose a download folder"
          choose={() => invoke<string | null>("browser_choose_download_directory")}
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
