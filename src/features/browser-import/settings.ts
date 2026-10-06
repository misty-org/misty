import { browserSearchEngineStorageIndex, useSettingsStore } from "@/features/settings";
import {
  browserSearchEngines,
  normalizeBrowserHomeUrl,
  type BrowserSearchEngine,
} from "@/features/workspace";
import type { ImportedSettings } from "./native";

function host(url: string) {
  try {
    return new URL(url.replace("%s", "q").replace("{searchTerms}", "q")).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return "";
  }
}

/** Misty's engine for an imported one, by its search address or its name. */
export function matchSearchEngine(engine: {
  name: string;
  url: string;
}): BrowserSearchEngine | undefined {
  const target = host(engine.url);
  return (
    browserSearchEngines.find((candidate) => target && host(candidate.search) === target) ??
    browserSearchEngines.find(
      (candidate) => candidate.name.toLocaleLowerCase() === engine.name.trim().toLocaleLowerCase(),
    )
  );
}

/**
 * Applies the settings Misty has an equivalent for to the account, and returns
 * what changed in the person's words. An engine Misty doesn't offer is named
 * instead of guessed.
 */
export function applyImportedSettings(settings: ImportedSettings) {
  const update = useSettingsStore.getState().updateSetting;
  const applied: string[] = [];
  const skipped: string[] = [];
  if (settings.searchEngine) {
    const engine = matchSearchEngine(settings.searchEngine);
    if (engine) {
      update("general", "browser_search_engine_index", browserSearchEngineStorageIndex(engine.id));
      applied.push(`${engine.name} for search`);
    } else skipped.push(`${settings.searchEngine.name} isn't one of Misty's search engines`);
  }
  if (settings.homepage) {
    update("general", "browser_homepage", normalizeBrowserHomeUrl(settings.homepage));
    applied.push("your homepage");
  }
  if (typeof settings.restoreSession === "boolean") {
    update("general", "reopen_last_session", settings.restoreSession);
    applied.push(settings.restoreSession ? "reopening your last session" : "starting fresh");
  }
  if (typeof settings.showBookmarksBar === "boolean") {
    update("general", "browser_bookmarks_bar", settings.showBookmarksBar);
    applied.push(settings.showBookmarksBar ? "the bookmarks bar" : "a hidden bookmarks bar");
  }
  return { applied, skipped };
}
