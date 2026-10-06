import { dockLeaves, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { importBookmarks } from "./bookmarks";
import { browserImport, type ImportedExtension, type ImportSourceRequest } from "./native";
import { applyImportedSettings } from "./settings";

export type ImportKind = "bookmarks" | "history" | "settings" | "signins" | "extensions";
export const importKinds: ImportKind[] = [
  "bookmarks",
  "history",
  "settings",
  "signins",
  "extensions",
];

export interface ImportOutcome {
  kind: ImportKind;
  ok: boolean;
  /** One sentence for the person. */
  message: string;
  extensions?: ImportedExtension[];
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** The Misty browser profile new pages open in: the focused tab's, else the default. */
export function currentBrowserProfile(): string | undefined {
  const workspace = useWorkspaceStore.getState();
  const panes = dockLeaves(workspace.layout.root);
  const pane = panes.find((p) => p.id === workspace.layout.focusedPaneId) ?? panes[0];
  const views = [
    ...(pane?.views.filter((v) => v.id === pane.activeViewId) ?? []),
    ...panes.flatMap((p) => p.views),
  ];
  const browser = views.find(
    (v) => v.surfaceId === "browser" && !parseBrowserViewState(v.state).private,
  );
  return browser ? parseBrowserViewState(browser.state).profileId : undefined;
}

function failure(kind: ImportKind, error: unknown): ImportOutcome {
  return { kind, ok: false, message: error instanceof Error ? error.message : String(error) };
}

async function run(
  kind: ImportKind,
  source: ImportSourceRequest,
  mistyProfile: string | undefined,
  extensions: ImportedExtension[],
): Promise<ImportOutcome> {
  const target = { source, mistyProfile };
  switch (kind) {
    case "bookmarks": {
      const { roots, skipped } = await browserImport.bookmarks(source);
      const result = importBookmarks(roots);
      const added = result.added.links
        ? `Added ${plural(result.added.links, "bookmark")}${result.added.folders ? ` in ${plural(result.added.folders, "folder")}` : ""}.`
        : "Your bookmarks were already here.";
      const left = skipped
        ? ` Left out ${plural(skipped, "link")} Misty can't open, such as bookmarklets.`
        : "";
      return { kind, ok: true, message: added + left };
    }
    case "history": {
      const { added } = await browserImport.history(target);
      return {
        kind,
        ok: true,
        message: added
          ? `Added ${plural(added, "visit")} to your history.`
          : "Your history was already here.",
      };
    }
    case "settings": {
      const { settings, sitePermissionsAdded } = await browserImport.settings(target);
      const { applied, skipped } = applyImportedSettings(settings);
      if (sitePermissionsAdded)
        applied.push(`camera and microphone choices for ${plural(sitePermissionsAdded, "site")}`);
      const parts = [
        applied.length ? `Now using ${applied.join(", ")}.` : "No settings needed changing.",
        ...skipped.map((note) => `${note}.`),
      ];
      return { kind, ok: true, message: parts.join(" ") };
    }
    case "signins": {
      const { added, locked } = await browserImport.signins(target);
      const locks = locked
        ? ` ${plural(locked, "sign-in")} stayed behind because that browser locks them to itself.`
        : "";
      return {
        kind,
        ok: added > 0 || locked === 0,
        message:
          (added
            ? `You're signed in where you were before (${plural(added, "saved sign-in")}).`
            : "No sign-ins could be brought across.") + locks,
      };
    }
    case "extensions":
      return {
        kind,
        ok: true,
        message: extensions.length
          ? "Find the same extensions in Misty's catalog."
          : "No extensions to bring across.",
        extensions,
      };
  }
}

/** Imports each chosen kind in turn; one kind failing never stops the rest. */
export async function runImport(
  source: ImportSourceRequest,
  kinds: ImportKind[],
  extensions: ImportedExtension[],
  onOutcome: (outcome: ImportOutcome) => void,
) {
  const mistyProfile = currentBrowserProfile();
  const outcomes: ImportOutcome[] = [];
  for (const kind of importKinds.filter((k) => kinds.includes(k))) {
    const outcome = await run(kind, source, mistyProfile, extensions).catch((error: unknown) =>
      failure(kind, error),
    );
    outcomes.push(outcome);
    onOutcome(outcome);
  }
  return outcomes;
}

/** Imports a bookmarks HTML file the person picks; `null` when they cancel. */
export async function importBookmarksFile(): Promise<ImportOutcome | null> {
  try {
    const file = await browserImport.bookmarksFile();
    if (!file) return null;
    const result = importBookmarks(file.roots);
    return {
      kind: "bookmarks",
      ok: true,
      message: result.added.links
        ? `Added ${plural(result.added.links, "bookmark")}${result.added.folders ? ` in ${plural(result.added.folders, "folder")}` : ""}.`
        : "Those bookmarks were already here.",
    };
  } catch (error) {
    return failure("bookmarks", error);
  }
}
