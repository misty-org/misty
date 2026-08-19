import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { stringSetting, TextControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function ExtensionsSection(props: SettingsContentProps) {
  return (
    <SettingsSectionBlock title="Tools">
      <SettingsRow
        label="Extension tools PATH"
        description={
          "Directories Misty searches for tools such as FFmpeg and yt-dlp. Defaults to your macOS " +
          "login-shell PATH. Enter PATH directories only, separated by colons — not a shell command."
        }
        last
      >
        <TextControl
          value={stringSetting(props.document, "advanced", "extension_tools_path", "")}
          placeholder="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
          disabled={props.working}
          onCommit={(value) => props.onSettingChange("advanced", "extension_tools_path", value)}
          wide
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
