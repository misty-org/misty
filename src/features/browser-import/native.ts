import { invoke } from "@tauri-apps/api/core";

/** Mirrors `infra::browser_import`. Paths never cross: a source is named by
 * its browser and a profile ID from `discoverBrowsers`. */
export type ImportBrowser =
  | "chrome"
  | "edge"
  | "brave"
  | "arc"
  | "vivaldi"
  | "opera"
  | "chromium"
  | "firefox"
  | "zen"
  | "safari";
export interface ImportProfile {
  id: string;
  name: string;
  /** When its browsing data last changed (ms); sources and profiles come newest first. */
  lastUsed?: number | null;
}
export interface ImportSource {
  browser: ImportBrowser;
  name: string;
  profiles: ImportProfile[];
}
export interface ImportSourceRequest {
  browser: ImportBrowser;
  profile: string;
}

export type ImportedBookmarkNode =
  | { kind: "folder"; title: string; addedAt?: number; children: ImportedBookmarkNode[] }
  | { kind: "link"; title: string; url: string; addedAt?: number };
export interface ImportedBookmarkRoots {
  bar: ImportedBookmarkNode[];
  other: ImportedBookmarkNode[];
  mobile: ImportedBookmarkNode[];
}
export interface ImportedBookmarks {
  roots: ImportedBookmarkRoots;
  skipped: number;
}

/** A kind a source has, or why it can't come across. */
export interface Available<T> {
  value?: T | null;
  issue?: string | null;
}
export type ImportSettingKind = "searchEngine" | "homepage" | "startup" | "sitePermissions";
export interface ImportedExtension {
  id: string;
  name: string;
}
export interface ImportPreview {
  bookmarks: Available<{ links: number; folders: number }>;
  history: Available<number>;
  settings: ImportSettingKind[];
  /** Sites with saved sign-ins. */
  signins: Available<number>;
  extensions: ImportedExtension[];
}
export interface ImportedSettings {
  searchEngine?: { name: string; url: string } | null;
  homepage?: string | null;
  restoreSession?: boolean | null;
  sitePermissions: { origin: string; kind: "camera" | "microphone"; allow: boolean }[];
}
/** Where history, site permissions and sign-ins land: a Misty browser profile. */
export interface ImportTargetRequest {
  source: ImportSourceRequest;
  mistyProfile?: string;
}
export interface ImportAdded {
  added: number;
  /** Sign-ins the source browser locks to itself. */
  locked: number;
}

export const browserImport = {
  discover: () => invoke<ImportSource[]>("browser_import_discover"),
  preview: (request: ImportSourceRequest) =>
    invoke<ImportPreview>("browser_import_preview", { request }),
  history: (request: ImportTargetRequest) =>
    invoke<ImportAdded>("browser_import_history", { request }),
  settings: (request: ImportTargetRequest) =>
    invoke<{ settings: ImportedSettings; sitePermissionsAdded: number }>(
      "browser_import_settings",
      { request },
    ),
  signins: (request: ImportTargetRequest) =>
    invoke<ImportAdded>("browser_import_signins", { request }),
  bookmarks: (request: ImportSourceRequest) =>
    invoke<ImportedBookmarks>("browser_import_bookmarks", { request }),
  bookmarksFile: () => invoke<ImportedBookmarks | null>("browser_import_bookmarks_file"),
  saveBookmarks: (roots: ImportedBookmarkRoots) =>
    invoke<boolean>("browser_import_save_bookmarks", { roots }),
};
