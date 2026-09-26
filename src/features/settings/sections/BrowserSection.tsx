import { hasTauriInternals } from "@/shared/platform/tauri";
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
  FilePathControl,
  SelectControl,
  stringSetting,
  SwitchControl,
  TextControl,
} from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { definitionById, runtimeAdapters } from "../profiles/registry";

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
  const engineName =
    browserSearchEngines.find((engine) => engine.id === engineId)?.name ?? "your search engine";
  return (
    <SettingsSectionBlock title={props.page === "downloads" ? "Downloads" : "Browsing"}>
      {props.page !== "downloads" && (
        <>
          <SettingsRow
            label="Search engine"
            description="Where a typed phrase goes when it is not a web address."
          >
            <SelectControl
              value={Math.max(0, browserSearchEngines.findIndex((engine) => engine.id === engineId))}
              options={browserSearchEngines.map((engine) => engine.name)}
              disabled={props.working}
              onChange={(index) =>
                props.onSettingChange(
                  "general",
                  "browser_search_engine_index",
                  engineStorageIndex(browserSearchEngines[index].id),
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            label="Show search suggestions"
            description={`Send what you type in the address bar to ${engineName} to suggest searches.`}
          >
            <SwitchControl
              checked={booleanSetting(props.document, "general", "browser_search_suggestions", false)}
              disabled={props.working}
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
              checked={booleanSetting(props.document, "general", "browser_download_prompt", false)}
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
            label="Open links externally"
            description="Open web links in your system browser."
          >
            <SwitchControl
              checked={booleanSetting(props.document, "general", "open_links_externally", false)}
              onChange={(value) => props.onSettingChange("general", "open_links_externally", value)}
              disabled={props.working}
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
        </>
      )}
    </SettingsSectionBlock>
  );
}
