import { defaultBrowserHomeUrl, normalizeBrowserHomeUrl } from "../addresses/browserHome";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { stringSetting, TextControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

type TabsSettingsProps = Pick<SettingsContentProps, "document" | "working" | "onSettingChange">;

/** General › Agent pages: where an agent's new page opens. Sleeping hidden pages is under Advanced. */
export function TabsSettings(props: TabsSettingsProps) {
  return (
    <SettingsSectionBlock title="Agent pages">
      <SettingsRow label="Homepage" description="Where an agent's new page opens.">
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
    </SettingsSectionBlock>
  );
}
