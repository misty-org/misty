/** Browser integration fixture for the shared Files controls, SDK store and thumbnail adapter. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMistyAppSDK } from "@misty/sdk";
import { createSdkFilesStore } from "../src/features/files/sdkFilesStore";
import { createSdkFilesPreviewRuntime } from "../src/features/files/sdkFilesPreview";
import { GlobalPreviewDialogView } from "../src/features/files/explorer/components/globalPreview/GlobalPreviewDialogView";
import type { GlobalPreviewSource } from "../src/features/files/explorer/model/interfaces/components/GlobalPreview";
import { createSdkFilesThumbnails } from "../src/features/files/sdkFilesThumbnails";
import { SdkFilesPaneView } from "../src/features/files/SdkFilesPaneView";
import { Pencil } from "lucide-react";
import { FileBrowserRuntimeProvider } from "../src/features/files/explorer/components/fileBrowser/FileBrowserRuntime";
import { ExplorerToolbarView } from "../src/features/files/explorer/components/ExplorerToolbarView";
import { ExplorerPaneToolbarActions } from "../src/features/files/explorer/components/ExplorerPaneToolbarActions";
import { Input, TooltipProvider } from "../src/shared/ui";
import type { ExplorerToolbarRuntime } from "../src/features/files/explorer/components/ExplorerToolbarRuntime";

const fixtureCanvas = document.createElement("canvas");
fixtureCanvas.width = 3;
fixtureCanvas.height = 2;
fixtureCanvas.getContext("2d")!.fillStyle = "#cc3344";
fixtureCanvas.getContext("2d")!.fillRect(0, 0, 3, 2);
const png = await new Promise<Blob>((resolve) => fixtureCanvas.toBlob((blob) => resolve(blob!)));
const Zip = (await import("jszip")).default;
const archive = await new Zip()
  .file("inside.txt", "SDK archive content")
  .generateAsync({ type: "uint8array" });
const data = new Map<string, Uint8Array>([
  ["fixture.zip", archive],
  ["fixture.png", new Uint8Array(await png.arrayBuffer())],
  ["日本語.txt", new TextEncoder().encode("SDK-owned file\r\n")],
]);
const handles = new Set<string>(),
  watchers = new Set<string>(),
  urls = new Set<string>();
const calls: string[] = [],
  errors: string[] = [];
const createUrl = URL.createObjectURL.bind(URL),
  revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createUrl(blob);
  urls.add(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  urls.delete(url);
  revokeUrl(url);
};
const token = (name: string) =>
  "u:" +
  btoa(String.fromCharCode(...new TextEncoder().encode(name)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
let next = 0;
const names = new Map<string, string>();
const drafts = new Map<string, { name: string; bytes: Uint8Array }>();
const grant = (name: string) => {
  const handle = `grant-${++next}`;
  handles.add(handle);
  names.set(handle, name);
  return handle;
};
const sdk = createMistyAppSDK({
  async request(message) {
    calls.push(message.method);
    const p = (message.params ?? {}) as Record<string, any>;
    const entryName = () => [...data.keys()].find((name) => token(name) === p.entry)!;
    const owned = () => {
      if (!handles.has(p.handle ?? p.directory)) throw new Error("Foreign or closed handle");
    };
    switch (message.method) {
      case "lifecycle.ready":
        return;
      case "files.pickDirectory":
        return { handle: grant("root"), name: "SDK Files" };
      case "files.watchDirectory":
        owned();
        watchers.add("watch");
        return { watcher: "watch" };
      case "files.watchStatus":
        return { revision: 0, active: watchers.has(p.watcher), reason: null };
      case "files.watchClose":
        watchers.delete(p.watcher);
        return;
      case "files.listDirectory":
        owned();
        return {
          entries: [...data].map(([name, bytes]) => ({
            entry: token(name),
            name,
            kind: "file",
            bytes: bytes.length,
          })),
          nextOffset: null,
        };
      case "files.openEntry":
        owned();
        return {
          handle: grant(entryName()),
          name: entryName(),
          kind: "file",
          bytes: data.get(entryName())!.length,
        };
      case "files.stat":
        owned();
        return {
          kind: names.get(p.handle) === "root" ? "directory" : "file",
          bytes: data.get(names.get(p.handle)!)?.length ?? 0,
          modifiedMs: 0,
          createdMs: 0,
          readOnly: false,
          writeGranted: true,
        };
      case "files.listArchive":
        owned();
        if (names.get(p.handle) !== "fixture.zip") throw new Error("Unexpected archive handle");
        return {
          format: "zip",
          entries: [{ path: "inside.txt", isDir: false, compressedSize: 19, uncompressedSize: 19 }],
        };
      case "files.readBytes":
        owned();
        return data.get(names.get(p.handle)!)!.slice(p.offset, p.offset + p.length).buffer;
      case "files.readText":
        owned();
        return { text: new TextDecoder().decode(data.get(names.get(p.handle)!)) };
      case "files.writeText":
        owned();
        data.set(names.get(p.handle)!, new TextEncoder().encode(p.text));
        return;
      case "files.createCopy": {
        owned();
        const handle = `draft-${++next}`;
        drafts.set(handle, { name: p.name, bytes: new Uint8Array() });
        return { handle };
      }
      case "files.appendCopy": {
        const draft = drafts.get(p.handle)!;
        if (!draft) throw new Error("Unknown draft");
        const bytes = new Uint8Array(draft.bytes.length + p.bytes.byteLength);
        bytes.set(draft.bytes);
        bytes.set(new Uint8Array(p.bytes), draft.bytes.length);
        draft.bytes = bytes;
        return;
      }
      case "files.replaceCopy": {
        const draft = drafts.get(p.handle)!;
        if (!draft || !handles.has(p.target)) throw new Error("Unknown save handles");
        data.set(names.get(p.target)!, draft.bytes);
        drafts.delete(p.handle);
        return;
      }
      case "files.commitCopy": {
        const draft = drafts.get(p.handle)!;
        if (!draft) throw new Error("Unknown draft");
        let name = draft.name;
        for (let index = 1; data.has(name); index++)
          name = draft.name.replace(/(\.[^.]+)?$/, ` ${index}$1`);
        data.set(name, draft.bytes);
        drafts.delete(p.handle);
        return { name, bytes: draft.bytes.length };
      }
      case "files.discardCopy":
        drafts.delete(p.handle);
        return;
      case "files.openExternal":
        owned();
        return;
      case "files.createEntry":
        owned();
        if (data.has(p.name)) throw new Error("File exists");
        data.set(p.name, new Uint8Array());
        return { entry: token(p.name), name: p.name, kind: p.kind };
      case "files.renameEntry":
        owned();
        if (data.has(p.name)) throw new Error("File exists");
        data.set(p.name, data.get(entryName())!);
        data.delete(entryName());
        return { entry: token(p.name), name: p.name };
      case "files.removeEntry":
        owned();
        data.delete(entryName());
        return;
      case "files.release":
        handles.delete(p.handle);
        names.delete(p.handle);
        return;
      default:
        throw new Error(`Unexpected SDK method: ${message.method}`);
    }
  },
});
const lifetime = new AbortController();
const files = createSdkFilesStore(sdk, lifetime.signal);
const thumbnails = createSdkFilesThumbnails(files, lifetime.signal);
const report = (cause: unknown) => {
  errors.push(String(cause));
  files.error(cause);
};
const browserRuntime = {
  ...thumbnails,
  thumbnailPreviewsEnabled: true,
  compactModeEnabled: false,
  Error: ({ error }: { error: string }) => <div role="alert">{error}</div>,
};
const toolbarRuntime: ExplorerToolbarRuntime = {
  DropTarget: ({ children }) => <>{children}</>,
  Search: (props) => (
    <Input
      aria-label="Filter SDK Files"
      value={props.commandQuery}
      onChange={(event) => props.onCommandQuery(event.target.value)}
    />
  ),
};
const previewRuntime = createSdkFilesPreviewRuntime(files, {
  Error: ({ error }) => <div role="alert">{String(error)}</div>,
});
function Pane() {
  const state = files.store();
  const [preview, setPreview] = useState<GlobalPreviewSource | null>(null);
  const { pane } = state;
  const run = (action: () => Promise<unknown>) => () => {
    void action().catch(report);
  };
  const actionProps = {
    path: pane.listing?.path ?? "",
    viewMode: state.viewMode,
    itemScale: 1,
    sort: state.sort,
    showHidden: state.showHidden,
    selectedCount: pane.selectedIds.length,
    selectedEntryPath: files.selected()[0]?.path ?? null,
    hasRemoteSelection: false,
    canOpenWithSelected: false,
    canCalculateDirectorySizes: false,
    onViewMode: files.setViewMode,
    onItemScale: () => {},
    onSort: files.setSort,
    onToggleHidden: run(files.toggleHidden),
    onRefresh: run(files.refresh),
    onCalculateDirectorySizes: () => {},
    onDownload: () => {},
    onOpenWith: () => {},
    onCopyPath: () => {},
  };
  return (
    <TooltipProvider>
      <FileBrowserRuntimeProvider value={browserRuntime}>
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <ExplorerToolbarView
            {...actionProps}
            runtime={toolbarRuntime}
            paneId="sdk-pane"
            commandQuery={pane.commandQuery}
            commandQueryMode="filter"
            locationResults={[]}
            pluginCommands={[]}
            onNavigate={(path) => void files.navigate(path).catch(report)}
            onNavigateLocation={(path) => void files.navigate(path).catch(report)}
            onNavigateSearchResult={() => {}}
            backPath={pane.backHistory.slice(-1)[0] ?? null}
            forwardPath={pane.forwardHistory.slice(-1)[0] ?? null}
            parentPath={pane.listing?.parentPath ?? null}
            canCreateFile={!!pane.listing}
            canCreateFolder={false}
            canUndo={false}
            canRedo={false}
            undoTitle="Undo"
            redoTitle="Redo"
            onBack={run(files.back)}
            onForward={run(files.forward)}
            onParent={run(files.parent)}
            onCommandQuery={files.setQuery}
            onCommandQueryMode={() => {}}
            onCreateFile={() => files.startInlineCreate("file", "sdk-pane")}
            onCreateFolder={() => {}}
            onCut={() => files.copy("move")}
            onCopy={() => files.copy("copy")}
            onPaste={run(() => files.paste())}
            onRename={() => files.startInlineRename("sdk-pane")}
            onDelete={run(() => files.remove(files.selected()[0].path))}
            onUndo={() => {}}
            onRedo={() => {}}
            onRunCommand={() => {}}
          />
          <ExplorerPaneToolbarActions {...actionProps} />
          <div style={{ flex: 1, minHeight: 0 }}>
            <SdkFilesPaneView
              files={files}
              paneId="sdk-pane"
              runtime={browserRuntime}
              itemScale={1}
              directorySizes={{}}
              cutPaths={new Set()}
              onOpenFile={(entry) =>
                setPreview({
                  path: entry.path,
                  name: entry.name,
                  sizeBytes: entry.sizeBytes,
                  extension: entry.extension || undefined,
                })
              }
              onDropItems={() => {}}
              menuEntries={() => [
                {
                  id: "rename",
                  label: "Rename",
                  icon: <Pencil size={17} />,
                  disabled: !files.selected().length,
                  onRun: () => files.startInlineRename("sdk-pane"),
                },
              ]}
            />
          </div>
          {preview && (
            <GlobalPreviewDialogView
              source={preview}
              runtime={previewRuntime}
              onClose={() => setPreview(null)}
            />
          )}
        </div>
      </FileBrowserRuntimeProvider>
    </TooltipProvider>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Pane />);
await files.openFolder();
Object.assign(window, {
  filesProbe: {
    calls,
    errors,
    snapshot: () => ({
      handles: handles.size,
      drafts: drafts.size,
      contents: Object.fromEntries(
        [...data]
          .filter(([name]) => name.endsWith(".txt"))
          .map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
      ),
      watchers: watchers.size,
      urls: urls.size,
      names: [...data.keys()],
    }),
    async close() {
      root.unmount();
      thumbnails.close();
      lifetime.abort();
      await files.close();
    },
  },
});
