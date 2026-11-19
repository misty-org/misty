import type { Extension } from "@codemirror/state";

/**
 * Where an editor is shown: the chat's floating panel, or the Code page. Add-ons that belong to the
 * Code page (the Misty theme, language servers, live sessions) return nothing in the panel.
 */
export type EditorAppearance = "panel" | "page";

/** What an add-on knows about the editor it joins. */
export interface EditorAddonContext {
  /** The file's absolute path. */
  path: string;
  /** The folder the Code page or panel shows, which holds `path`; "" while none is linked. */
  root: string;
  appearance: EditorAppearance;
  /** The file's text as it was read from disk. */
  diskText: string;
}

/**
 * What one add-on brings to an editor. Hooks return the same object (and the same `extensions`
 * array) until something they depend on changes, since a new array reconfigures CodeMirror.
 */
export interface EditorAddon {
  extensions: readonly Extension[];
  /**
   * The text the editor starts from instead of the file on disk, and a key that changes whenever
   * it does: a live session's shared copy. The editor starts over when the key changes.
   */
  document?: { key: string; text: string };
  /** The add-on writes the file itself (a live session does), so the editor never shows it as
   * unsaved and ⌘S has nothing to do. */
  savesItself?: boolean;
}

export const noAddon: EditorAddon = { extensions: [] };
