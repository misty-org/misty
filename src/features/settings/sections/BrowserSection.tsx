import { hasTauriInternals } from "@/shared/platform/tauri";
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
import { BrowserToolbarSettings } from "./BrowserToolbarSettings";
import { DefaultBrowserRow } from "./DefaultBrowserRow";

type BrowserSettingsProps = Pick<SettingsContentProps, "document" | "working" | "onSettingChange">;

/** Browsing › Links: how links reach Misty and what pages show around them. */
export function BrowserLinksSettings(props: BrowserSettingsProps) {
  return (
    <SettingsSectionBlock title="Links">
      <DefaultBrowserRow />
      <SettingsRow
        label="Links from other apps"
        description="Peek shows a link over the page you're on, so you can keep it as a tab or close it."
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
        label="Link previews"
        description={
          "Show a card with a picture and title under links in replies and chats. Misty fetches " +
          "each page from this device, without cookies or sign-ins, so the site sees your address."
        }
      >
        <SwitchControl
          checked={booleanSetting(props.document, "general", "browser_link_previews", true)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "browser_link_previews", value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Link and loading status"
        description="Show where a link goes, and when a page is loading, in the corner of the page."
      >
        <SwitchControl
          checked={booleanSetting(props.document, "general", "browser_status_bubble", true)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "browser_status_bubble", value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Mouse gestures"
        description="Hold the right button and drag left to go back, right to go forward or up to reload."
      >
        <SwitchControl
          checked={booleanSetting(props.document, "general", "browser_mouse_gestures", false)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "browser_mouse_gestures", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}

/** Search: where typed searches go and what the address bar suggests. */
export function SearchSettings(props: BrowserSettingsProps) {
  return (
    <SettingsSectionBlock title="Search">
      <SettingsRow
        label="Show search suggestions"
        description="Send what you type in the address bar to your search engine to suggest searches and sites."
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

/** Browsing › Downloads: where files from websites are saved. */
export function DownloadsSettings(props: BrowserSettingsProps) {
  return (
    <SettingsSectionBlock title="Downloads">
      <SettingsRow
        label="Download location"
        description={
          hasTauriInternals()
            ? "Where files downloaded from websites are saved."
            : "Choose a download folder in the native app. Web downloads follow your browser settings."
        }
      >
        <FilePathControl
          directory
          title="Choose a download folder"
          value={stringSetting(props.document, "general", "browser_download_directory", "")}
          emptyLabel="Downloads folder"
          disabled={props.working || !hasTauriInternals()}
          onChange={(value) =>
            props.onSettingChange("general", "browser_download_directory", value)
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Ask where to save each file"
        description="Choose a folder and name every time you download something."
      >
        <SwitchControl
          checked={booleanSetting(props.document, "general", "browser_download_prompt", false)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "browser_download_prompt", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}

/** Browsing › Sites: how websites look and zoom, then the browser toolbar. */
export function BrowserSitesSettings(props: BrowserSettingsProps) {
  return <BrowserToolbarSettings {...props} />;
}
