import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  browserSearchEngines,
  defaultBrowserHomeUrl,
  normalizeBrowserHomeUrl,
} from "@/features/workspace";
import { parseBrowserCustomBangs } from "@/features/workspace/browserSearchEngine";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  ChoiceControl,
  FilePathControl,
  numberSetting,
  SelectControl,
  stringSetting,
  SwitchControl,
  TextControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { definitionById, runtimeAdapters } from "../profiles/registry";
import { BrowserBangsSettings } from "./BrowserBangsSettings";
import { BrowserToolbarSettings } from "./BrowserToolbarSettings";
import { DefaultBrowserRow } from "./DefaultBrowserRow";
import { PreferenceRow } from "./FeatureSections";
import { parseSiteZoomLevels } from "@/features/webviews/siteZoom";
import { parseSiteStyles } from "@/features/webviews/siteStyles";
import { parseContentBlockingAllowedSites } from "@/features/webviews/contentBlocking";
import { pictureInPictureSupported } from "@/features/webviews/pictureInPictureSettings";

const archiveOptions = [
  { value: "0", label: "Never" },
  { value: "12", label: "After 12 hours" },
  { value: "24", label: "After 1 day" },
  { value: "168", label: "After 1 week" },
  { value: "720", label: "After 30 days" },
];

const tabSleepOptions = [
  { value: "0", label: "Never" },
  { value: "15", label: "After 15 minutes" },
  { value: "30", label: "After 30 minutes" },
  { value: "60", label: "After 1 hour" },
  { value: "120", label: "After 2 hours" },
];

// The engine is stored by its legacy index; ids stay stable if the list is reordered.
const searchEngineSetting = runtimeAdapters.get("browser.searchEngine")!;
function engineStorageIndex(id: string): number {
  return definitionById.get("browser.searchEngine")!.legacyValues!.indexOf(id);
}

export function BrowserSection(
  props: Pick<SettingsContentProps, "document" | "working" | "onSettingChange"> & {
    page?: "browsing" | "downloads";
  },
) {
  const engineId = String(searchEngineSetting.read(props.document));
  const customEngines = parseBrowserCustomBangs(
    stringSetting(props.document, "general", "browser_custom_bangs_json", "[]"),
  );
  const customTrigger = stringSetting(props.document, "general", "browser_custom_search_engine", "")
    .trim()
    .toLowerCase();
  // A deleted shortcut falls back to the built-in engine, the same as in the browser.
  const customIndex = customEngines.findIndex((bang) => bang.trigger === customTrigger);
  const engineName =
    customIndex >= 0
      ? customEngines[customIndex].name
      : (browserSearchEngines.find((engine) => engine.id === engineId)?.name ??
        "your search engine");
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
              label="Search engine"
              description="Where a typed phrase goes when it is not a web address."
            >
              <SelectControl
                value={
                  customIndex >= 0
                    ? browserSearchEngines.length + customIndex
                    : Math.max(
                        0,
                        browserSearchEngines.findIndex((engine) => engine.id === engineId),
                      )
                }
                options={[
                  ...browserSearchEngines.map((engine) => engine.name),
                  ...customEngines.map((bang) => `${bang.name} (!${bang.trigger})`),
                ]}
                disabled={props.working}
                onChange={(index) => {
                  if (index >= browserSearchEngines.length) {
                    const bang = customEngines[index - browserSearchEngines.length];
                    if (bang)
                      props.onSettingChange(
                        "general",
                        "browser_custom_search_engine",
                        bang.trigger,
                      );
                    return;
                  }
                  if (customTrigger)
                    props.onSettingChange("general", "browser_custom_search_engine", "");
                  props.onSettingChange(
                    "general",
                    "browser_search_engine_index",
                    engineStorageIndex(browserSearchEngines[index].id),
                  );
                }}
              />
            </SettingsRow>
            <SettingsRow
              label="Show search suggestions"
              muted={customIndex >= 0}
              description={
                customIndex >= 0
                  ? `Suggestions are not available while ${engineName} is the search engine.`
                  : `Send what you type in the address bar to ${engineName} to suggest searches.`
              }
            >
              <SwitchControl
                checked={booleanSetting(
                  props.document,
                  "general",
                  "browser_search_suggestions",
                  false,
                )}
                disabled={props.working || customIndex >= 0}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_search_suggestions", value)
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
            <SettingsRow
              label="Block ads and trackers"
              description="Stops known ad and tracking services that other sites load. You can turn it off for a site from its site information."
            >
              <SwitchControl
                checked={booleanSetting(
                  props.document,
                  "general",
                  "browser_content_blocking",
                  true,
                )}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("general", "browser_content_blocking", value)
                }
              />
            </SettingsRow>
            <ContentBlockingSitesRow document={props.document} />
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
              label="Sleep inactive tabs"
              description="Tabs you haven't looked at for a while free their memory and reload when you return. Tabs playing sound stay awake."
            >
              <ChoiceControl
                value={String(
                  numberSetting(props.document, "general", "browser_tab_sleep_minutes", 30),
                )}
                options={tabSleepOptions}
                disabled={props.working}
                onValueChange={(value) =>
                  props.onSettingChange("general", "browser_tab_sleep_minutes", Number(value))
                }
              />
            </SettingsRow>
            {pictureInPictureSupported() && (
              <SettingsRow
                label="Picture in picture when switching tabs"
                description="A video playing with sound keeps going in a floating window when you switch away from its tab."
              >
                <SwitchControl
                  checked={booleanSetting(
                    props.document,
                    "general",
                    "browser_auto_picture_in_picture",
                    true,
                  )}
                  disabled={props.working}
                  onChange={(value) =>
                    props.onSettingChange("general", "browser_auto_picture_in_picture", value)
                  }
                />
              </SettingsRow>
            )}
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
      {props.page !== "downloads" && (
        <SettingsSectionBlock title="Extensions">
          <PreferenceRow
            id="extensions.agent_access"
            description="Individual extensions can also be turned off for agents in Extensions."
          />
        </SettingsSectionBlock>
      )}
      {props.page !== "downloads" && <BrowserToolbarSettings {...props} />}
      {props.page !== "downloads" && <BrowserBangsSettings {...props} />}
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

/** Sites where blocking was turned off; Reset turns it back on everywhere. */
function ContentBlockingSitesRow(props: { document: SettingsContentProps["document"] }) {
  const sites = parseContentBlockingAllowedSites(
    stringSetting(props.document, "general", "browser_content_blocking_allowed_json", "[]"),
  );
  return (
    <SettingsRow
      label="Sites without blocking"
      indent
      description={
        sites.length ? sites.slice(0, 3).join(", ") + (sites.length > 3 ? "…" : "") : undefined
      }
    >
      <span className="text-sm text-cream-muted">
        {sites.length === 0 ? "None" : sites.length === 1 ? "1 site" : `${sites.length} sites`}
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
