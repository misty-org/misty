import { hasTauriInternals } from "@/shared/platform/tauri";
import { defaultBrowserHomeUrl, normalizeBrowserHomeUrl } from "@/features/workspace";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  ChoiceControl,
  FilePathControl,
  numberSetting,
  stringSetting,
  SwitchControl,
  TextControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { BrowserToolbarSettings } from "./BrowserToolbarSettings";
import { DefaultBrowserRow } from "./DefaultBrowserRow";
import { parseSiteZoomLevels } from "@/features/webviews/siteZoom";
import { parseSiteStyles } from "@/features/webviews/siteStyles";

const archiveOptions = [
  { value: "0", label: "Never" },
  { value: "12", label: "After 12 hours" },
  { value: "24", label: "After 1 day" },
  { value: "168", label: "After 1 week" },
  { value: "720", label: "After 30 days" },
];

export function BrowserSection(
  props: Pick<SettingsContentProps, "document" | "working" | "onSettingChange"> & {
    page?: "browsing" | "downloads";
  },
) {
  return (
    <>
      <SettingsSectionBlock title={props.page === "downloads" ? "Downloads" : "Browsing"}>
        {props.page !== "downloads" && (
          <>
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
              label="Show search suggestions"
              description="Send what you type in the address bar to Google to suggest searches and sites."
            >
              <SwitchControl
                checked={booleanSetting(
                  props.document,
                  "general",
                  "browser_search_suggestions",
                  false,
                )}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_search_suggestions", value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Link previews"
              description="Show a card with a picture and title under links in replies and chats. Misty fetches each page from this device, without cookies or sign-ins, so the site sees your address."
            >
              <SwitchControl
                checked={booleanSetting(props.document, "general", "browser_link_previews", true)}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_link_previews", value)
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
          </>
        )}
        {props.page === "downloads" && (
          <>
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
                checked={booleanSetting(
                  props.document,
                  "general",
                  "browser_download_prompt",
                  false,
                )}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_download_prompt", value)
                }
              />
            </SettingsRow>
          </>
        )}
        {props.page !== "downloads" && (
          <>
            <SiteZoomRow document={props.document} />
            <CustomizedSitesRow document={props.document} />
            <SettingsRow
              label="Archive idle tabs"
              description="Close tabs you haven't looked at for a while. Pinned, grouped and playing tabs stay. Find them in History under Archived."
            >
              <ChoiceControl
                value={String(
                  numberSetting(props.document, "general", "browser_auto_archive_hours", 0),
                )}
                options={archiveOptions}
                disabled={props.working}
                onValueChange={(value) =>
                  props.onSettingChange("general", "browser_auto_archive_hours", Number(value))
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Mouse gestures"
              description="Hold the right button and drag left to go back, right to go forward or up to reload."
            >
              <SwitchControl
                checked={booleanSetting(props.document, "general", "browser_mouse_gestures", false)}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_mouse_gestures", value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Link and loading status"
              description="Show where a link goes, and when a page is loading, in the corner of the page."
            >
              <SwitchControl
                checked={booleanSetting(props.document, "general", "browser_status_bubble", true)}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_status_bubble", value)
                }
              />
            </SettingsRow>
          </>
        )}
      </SettingsSectionBlock>
      {props.page !== "downloads" && <BrowserToolbarSettings {...props} />}
    </>
  );
}

/** Sites remember their own page zoom; Reset clears every saved level. */
function SiteZoomRow(props: { document: SettingsContentProps["document"] }) {
  const count = Object.keys(
    parseSiteZoomLevels(stringSetting(props.document, "general", "browser_site_zoom_json", "[]")),
  ).length;
  return (
    <SettingsRow
      label="Zoom by site"
      description="Each website opens at the zoom level you last chose for it."
    >
      <span className="text-sm text-cream-muted">
        {count === 0 ? "No sites zoomed" : count === 1 ? "1 site" : `${count} sites`}
      </span>
    </SettingsRow>
  );
}

/** Sites with their own CSS, hidden elements or dark mode; Reset clears them all. */
function CustomizedSitesRow(props: { document: SettingsContentProps["document"] }) {
  const sites = parseSiteStyles(
    stringSetting(props.document, "general", "browser_site_styles_json", "[]"),
  );
  return (
    <SettingsRow
      label="Customized sites"
      description="Change a site's look from its site information beside the address."
    >
      <span className="text-sm text-cream-muted">
        {sites.length === 0 ? "None" : sites.length === 1 ? "1 site" : `${sites.length} sites`}
      </span>
    </SettingsRow>
  );
}
