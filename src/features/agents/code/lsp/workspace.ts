import { LSPPlugin, Workspace, type LSPClient, type WorkspaceFile } from "@codemirror/lsp-client";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { joinPath, useFilesStore } from "../../context-panel/files/filesStore";

type FileUpdate = ReturnType<Workspace["syncFiles"]>[number];

/** How long a jump to another file waits for that file's editor to join the server. */
const DISPLAY_TIMEOUT_MS = 10_000;

/** Where a server's files live: the folder the Code page shows, and the same folder as the
 * native side resolved it (its real path), as a URI. */
export interface ServerPlace {
  root: string;
  folderUri: string;
}

/**
 * A URI in one spelling, so the same file matches however a server encodes it: decoded, a
 * Windows drive letter in lower case, no trailing slash.
 */
export function uriKey(uri: string): string {
  let text = uri;
  try {
    text = decodeURIComponent(uri);
  } catch {
    // A URI that isn't validly encoded is compared as it is.
  }
  return text
    .replace(
      /^file:\/\/\/([A-Za-z]):/,
      (_whole, drive: string) => `file:///${drive.toLowerCase()}:`,
    )
    .replace(/\/+$/, "");
}

/** The Code page's path for a file URI, or null for one outside its folder (a library's source). */
export function pathForUri(uri: string, place: ServerPlace): string | null {
  const key = uriKey(uri);
  const folder = uriKey(place.folderUri);
  if (!key.startsWith(`${folder}/`)) return null;
  const rest = key.slice(folder.length + 1);
  if (!rest || rest.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  return joinPath(place.root, rest);
}

class OpenFile implements WorkspaceFile {
  uri: string;
  languageId: string;
  version: number;
  doc: Text;
  /** Every editor showing it; the first is the one kept in step with the server. */
  views: EditorView[] = [];

  constructor(uri: string, languageId: string, version: number, doc: Text) {
    this.uri = uri;
    this.languageId = languageId;
    this.version = version;
    this.doc = doc;
  }

  getView(main?: EditorView): EditorView | null {
    if (main && this.views.includes(main)) return main;
    return this.views[0] ?? null;
  }
}

/**
 * The files one server knows about: those open in the Code page's editors. Unlike CodeMirror's
 * default it lets a file be in more than one editor, and a jump to another file opens that file's
 * tab and waits for its editor.
 */
export class CodeWorkspace extends Workspace {
  files: OpenFile[] = [];
  private readonly place: ServerPlace;
  private readonly versions = new Map<string, number>();
  private readonly waiting = new Map<string, Set<(view: EditorView) => void>>();

  constructor(client: LSPClient, place: ServerPlace) {
    super(client);
    this.place = place;
  }

  private nextVersion(uri: string): number {
    const version = (this.versions.get(uri) ?? -1) + 1;
    this.versions.set(uri, version);
    return version;
  }

  override getFile(uri: string): OpenFile | null {
    const key = uriKey(uri);
    return this.files.find((file) => uriKey(file.uri) === key) ?? null;
  }

  syncFiles(): readonly FileUpdate[] {
    const updates: FileUpdate[] = [];
    for (const file of this.files) {
      const view = file.views[0];
      const plugin = view ? LSPPlugin.get(view) : null;
      if (!view || !plugin || plugin.unsyncedChanges.empty) continue;
      updates.push({ file, prevDoc: file.doc, changes: plugin.unsyncedChanges });
      file.doc = view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
    }
    return updates;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const known = this.getFile(uri);
    if (known) {
      known.views.push(view);
    } else {
      const file = new OpenFile(uri, languageId, this.nextVersion(uri), view.state.doc);
      file.views.push(view);
      this.files.push(file);
      this.client.didOpen(file);
    }
    const key = uriKey(uri);
    const waiters = this.waiting.get(key);
    if (waiters) {
      this.waiting.delete(key);
      for (const resolve of waiters) resolve(view);
    }
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri);
    if (!file) return;
    const wasMain = file.views[0] === view;
    file.views = file.views.filter((open) => open !== view);
    const next = file.views[0];
    if (!next) {
      this.files = this.files.filter((open) => open !== file);
      this.client.didClose(file.uri);
      return;
    }
    if (wasMain) {
      // Another editor takes over: the server starts again from its text.
      this.client.didClose(file.uri);
      file.doc = next.state.doc;
      file.version = this.nextVersion(file.uri);
      LSPPlugin.get(next)?.clear();
      this.client.didOpen(file);
    }
  }

  override async displayFile(uri: string): Promise<EditorView | null> {
    const path = pathForUri(uri, this.place);
    if (!path) return null;
    const shown = this.getFile(uri)?.getView() ?? null;
    void useFilesStore
      .getState()
      .openFile(path)
      .catch(() => undefined);
    if (shown) return shown;
    const key = uriKey(uri);
    return new Promise<EditorView | null>((resolve) => {
      const waiters = this.waiting.get(key) ?? new Set<(view: EditorView) => void>();
      const done = (view: EditorView) => {
        clearTimeout(timer);
        resolve(view);
      };
      const timer = setTimeout(() => {
        waiters.delete(done);
        if (waiters.size === 0) this.waiting.delete(key);
        resolve(null);
      }, DISPLAY_TIMEOUT_MS);
      waiters.add(done);
      this.waiting.set(key, waiters);
    });
  }
}
