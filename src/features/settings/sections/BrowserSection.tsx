import {
  browserSearchEngines,
  defaultBrowserHomeUrl,
  normalizeBrowserHomeUrl,
} from "@/features/workspace";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { numberSetting, SelectControl, stringSetting, TextControl } from "../settingsControls";
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
    </SettingsSectionBlock>
  );
}
