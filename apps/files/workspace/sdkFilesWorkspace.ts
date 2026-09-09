import type { FileEntry } from "@/native/contracts";
import { create } from "zustand";
import type {
  MistyAppSDK,
  MistyFileSource,
  MistyWorkspaceSnapshot,
  MistyWorkspaceOpen,
} from "@misty/sdk";
import { MistyViewStateSchema } from "@misty/sdk";
import {
  parseSdkCodeProjectReference,
  type SdkCodeProjectReference,
} from "@/features/coding-workspace/sdkCodeProjectReference";
import {
  parseSdkCodeProjectHandoff,
  type SdkCodeProjectHandoff,
} from "@/features/coding-workspace/sdkCodeProjectHandoff";
import {
  createMultiPanelStore,
  destroyMultiPanelStore,
} from "@/features/workspace/useMultiPanelStore";
import { createSdkFilesStore } from "./sdkFilesStore";

interface FilesViewState {
  kind: "sdk-files";
  version: 1;
  folders: SdkCodeProjectReference[];
  sources: Record<string, MistyFileSource>;
  recent: FileEntry[];
  starred: FileEntry[];
  location:
    | { kind: "folder"; root: string; relative: string; handoff?: SdkCodeProjectHandoff }
    | { kind: "trash" | "recent" | "starred" }
    | null;
  sidebarWidth: number;
  previewWidth: number;
  previewVisible: boolean;
}
const initial = (): FilesViewState => ({
  kind: "sdk-files",
  version: 1,
  folders: [],
  sources: {},
  recent: [],
  starred: [],
  location: null,
  sidebarWidth: 220,
  previewWidth: 300,
  previewVisible: true,
});
function parse(value: unknown): FilesViewState {
  if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== "sdk-files")
    return initial();
  const raw = value as FilesViewState;
  if (raw.version !== 1 || !Array.isArray(raw.folders) || raw.folders.length > 32)
    throw new Error("Saved Files view is invalid.");
  const folders = raw.folders.map(parseSdkCodeProjectReference);
  if (new Set(folders.map((folder) => folder.root)).size !== folders.length)
    throw new Error("Saved Files folders are duplicated.");
  let location: FilesViewState["location"] = null;
  if (["trash", "recent", "starred"].includes(raw.location?.kind ?? ""))
    location = { kind: raw.location!.kind as "trash" | "recent" | "starred" };
  else if (raw.location?.kind === "folder") {
    const source = raw.location;
    if (
      !folders.some((folder) => folder.root === source.root) ||
      typeof source.relative !== "string" ||
      source.relative.includes("\0") ||
      (source.relative !== "" &&
        source.relative.split("/").some((part) => !part || part === "." || part === ".."))
    )
      throw new Error("Saved Files location is outside its folder.");
    const handoff = source.handoff ? parseSdkCodeProjectHandoff(source.handoff) : undefined;
    const reference = folders.find((folder) => folder.root === source.root)!;
    if (handoff && (handoff.root !== reference.root || handoff.write !== reference.write))
      throw new Error("Saved Files handoff does not match its folder.");
    location = {
      kind: "folder",
      root: source.root,
      relative: source.relative,
      ...(handoff ? { handoff } : {}),
    };
  } else if (raw.location !== null) throw new Error("Saved Files location is invalid.");
  const width = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    kind: "sdk-files",
    version: 1,
    folders,
    sources: raw.sources ?? {},
    recent: Array.isArray(raw.recent) ? raw.recent.slice(0, 100) : [],
    starred: Array.isArray(raw.starred) ? raw.starred.slice(0, 1000) : [],
    location,
    sidebarWidth: width(raw.sidebarWidth, 220, 160, 420),
    previewWidth: width(raw.previewWidth, 300, 220, 560),
    previewVisible: raw.previewVisible !== false,
  };
}

/** One host view owns its Files controller; new views receive independent native grants. */
export function createSdkFilesWorkspace(
  misty: MistyAppSDK,
  options: { viewId: string; signal: AbortSignal; report(error: unknown): void },
) {
  const lifetime = new AbortController();
  const files = createSdkFilesStore(misty, lifetime.signal);
  const multiPanel = createMultiPanelStore({
    idPrefix: `sdk-files-${options.viewId}`,
    defaultTitle: "Files",
  });
  multiPanel.getState().initialize("misty://choose-folder", "Files");
  const paneId = multiPanel.getState().activePaneId;
  const model = create(() => ({
    loading: true,
    sidebarVisible: true,
    previewVisible: true,
    sidebarWidth: 220,
    previewWidth: 300,
    active: true,
    focused: true,
  }));
  let closed = false,
    initializing = true,
    revision = -1,
    dirty = 0;
  let pending = Promise.resolve();
  let unsubscribeWorkspace: (() => void) | undefined;
  const assert = () => {
    if (closed || options.signal.aborted) throw new Error("This Files workspace is closed.");
  };
  const report = (cause: unknown) => {
    if (!closed) {
      files.error(cause);
      options.report(cause);
    }
  };
  function accept(snapshot: MistyWorkspaceSnapshot) {
    if (closed || snapshot.revision <= revision) return;
    revision = snapshot.revision;
    const own = snapshot.views.find((view) => view.viewId === options.viewId);
    if (!own) return;
    model.setState({
      active: own.active,
      focused: own.focused,
      ...(dirty === 0 ? { sidebarVisible: own.sidebarVisible } : {}),
    });
  }
  async function serialize(): Promise<FilesViewState> {
    const state = files.store.getState(),
      presentation = model.getState();
    const folders = [];
    for (const folder of state.folders) {
      folders.push(await folder.remember());
      assert();
    }
    const path = state.pane.listing?.path;
    const folder = state.folders.find(
      (folder) => path === folder.root || path?.startsWith(`${folder.root}/`),
    );
    const location: FilesViewState["location"] = [
      "misty://trash",
      "misty://recent",
      "misty://starred",
    ].includes(path ?? "")
      ? { kind: path!.slice("misty://".length) as "trash" | "recent" | "starred" }
      : folder && path
        ? {
            kind: "folder",
            root: folder.root,
            relative: path.slice(folder.root.length).replace(/^\//, ""),
          }
        : null;
    return {
      kind: "sdk-files",
      version: 1,
      folders,
      sources: Object.fromEntries(
        state.folders
          .filter((folder) => folder.source)
          .map((folder) => [folder.root, folder.source!]),
      ),
      recent: state.recent,
      starred: state.starred,
      location,
      sidebarWidth: presentation.sidebarWidth,
      previewWidth: presentation.previewWidth,
      previewVisible: presentation.previewVisible,
    };
  }
  function save() {
    if (closed || initializing) return pending;
    dirty++;
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        assert();
        const state = await serialize();
        assert();
        const title = files.store.getState().pane.listing?.title || "Files";
        await misty.workspace.update({
          viewId: options.viewId,
          state: MistyViewStateSchema.parse(state),
          title: title.slice(0, 160),
          sidebarVisible: model.getState().sidebarVisible,
        });
      })
      .catch(report)
      .finally(() => {
        dirty--;
      });
    return pending;
  }
  const unsubscribeFiles = files.store.subscribe((state, previous) => {
    if (state.pane.listing?.path !== previous.pane.listing?.path) {
      const path = state.pane.listing?.path ?? "misty://choose-folder";
      multiPanel.getState().updateActiveTabPath(paneId, path, state.pane.listing?.title || "Files");
      void save();
    }
  });
  async function restore(state: FilesViewState) {
    const location = state.location;
    model.setState({
      sidebarWidth: state.sidebarWidth,
      previewWidth: state.previewWidth,
      previewVisible: state.previewVisible,
    });
    for (const reference of state.folders) {
      assert();
      if (files.store.getState().folders.some((folder) => folder.root === reference.root)) continue;
      const handoff =
        location?.kind === "folder" && location.root === reference.root
          ? location.handoff
          : undefined;
      if (handoff) {
        try {
          await files.openFolder({ handoff, source: state.sources[reference.root] });
          continue;
        } catch {
          assert(); /* A hidden tab may mount after the temporary handoff expires. */
        }
      }
      await files.openFolder({ reference, source: state.sources[reference.root] });
    }
    files.store.setState({ recent: state.recent, starred: state.starred });
    if (location && ["trash", "recent", "starred"].includes(location.kind))
      await files.navigate(`misty://${location.kind}`);
    else if (location?.kind === "folder")
      await files.navigate(
        `${location.root}${location.relative ? `/${location.relative}` : ""}`,
        "replace",
      );
  }
  const ready = (async () => {
    try {
      assert();
      const remove = await misty.workspace.subscribe(accept);
      if (closed || options.signal.aborted) {
        remove();
        assert();
      }
      unsubscribeWorkspace = remove;
      const snapshot = await misty.workspace.snapshot();
      assert();
      accept(snapshot);
      const own = snapshot.views.find((view) => view.viewId === options.viewId);
      if (!own) throw new Error("This Files view is no longer in the workspace.");
      await restore(parse(own.state));
      assert();
    } catch (cause) {
      report(cause);
    } finally {
      initializing = false;
      if (!closed) model.setState({ loading: false });
    }
  })();
  let closing: Promise<void> | undefined;
  function close() {
    if (closing) return closing;
    closed = true;
    unsubscribeFiles();
    unsubscribeWorkspace?.();
    options.signal.removeEventListener("abort", onAbort);
    lifetime.abort();
    destroyMultiPanelStore(multiPanel);
    closing = files.close();
    return closing;
  }
  const onAbort = () => {
    void close();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  return {
    files,
    model,
    multiPanel,
    paneId,
    ready,
    close,
    flush: () => pending,
    async openView(
      path = files.store.getState().pane.listing?.path,
      placement: MistyWorkspaceOpen["placement"] = "tab",
    ) {
      assert();
      let state = initial(),
        title = "Files",
        cancel: (() => Promise<void>) | undefined;
      if (["misty://trash", "misty://recent", "misty://starred"].includes(path ?? "")) {
        state = await serialize();
        state.location = { kind: path!.slice("misty://".length) as "trash" | "recent" | "starred" };
        title = { trash: "Trash", recent: "Recent", starred: "Starred" }[state.location.kind];
      } else if (path) {
        const folder = files.owner(path),
          reference = await folder.remember();
        assert();
        const handoff = await folder.share();
        cancel = () => folder.cancelShare(handoff.ticket);
        title = path === folder.root ? folder.name : path.slice(path.lastIndexOf("/") + 1);
        state = {
          ...state,
          folders: [reference],
          sources: folder.source ? { [folder.root]: folder.source } : {},
          location: {
            kind: "folder",
            root: folder.root,
            relative: path.slice(folder.root.length).replace(/^\//, ""),
            handoff,
          },
        };
      }
      try {
        assert();
        return await misty.workspace.open({
          route: "/apps/files",
          placement,
          title: title.slice(0, 160),
          state: MistyViewStateSchema.parse(state),
        });
      } catch (cause) {
        await cancel?.().catch(() => undefined);
        throw cause;
      }
    },
    setSidebarVisible(sidebarVisible: boolean) {
      assert();
      model.setState({ sidebarVisible });
      return save();
    },
    setPreviewVisible(previewVisible: boolean) {
      assert();
      model.setState({ previewVisible });
      return save();
    },
    setSidebarWidth(sidebarWidth: number) {
      assert();
      model.setState({ sidebarWidth: Math.max(160, Math.min(420, sidebarWidth)) });
      return save();
    },
    setPreviewWidth(previewWidth: number) {
      assert();
      model.setState({ previewWidth: Math.max(220, Math.min(560, previewWidth)) });
      return save();
    },
    closeView: () => misty.workspace.close(options.viewId),
    focus: () => misty.workspace.focus(options.viewId),
  };
}
export type SdkFilesWorkspace = ReturnType<typeof createSdkFilesWorkspace>;
export { parse as parseSdkFilesViewState };
