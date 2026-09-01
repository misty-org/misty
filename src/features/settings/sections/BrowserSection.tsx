import {
  browserSearchEngines,
  defaultBrowserHomeUrl,
  normalizeBrowserHomeUrl,
} from "@/features/workspace";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  numberSetting,
  SelectControl,
  stringSetting,
  SwitchControl,
  TextControl,
} from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function BrowserSection(props: SettingsContentProps) {
  return (
    <SettingsSectionBlock title="Browsing">
      <SettingsRow
        label="Search engine"
        description="Where a typed phrase goes when it is not a web address."
      >
        <SelectControl
          value={numberSetting(props.document, "general", "browser_search_engine_index", 0)}
          options={browserSearchEngines.map((engine) => engine.name)}
          disabled={props.working}
          onChange={(value) =>
            props.onSettingChange("general", "browser_search_engine_index", value)
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
          wide
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
        label="Open links externally"
        description="Send external links to the system browser instead of handling them in-app."
        last
      >
        <SwitchControl
          checked={booleanSetting(props.document, "general", "open_links_externally", false)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "open_links_externally", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
