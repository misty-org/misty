import { useEffect, useMemo, useRef, useState } from "react";
import type { MistyAppSDK, MistyFileSource } from "@misty/sdk";
import type { FileEntry } from "@/native/contracts";
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from "@/shared/ui";
import { ArrowLeft, FolderOpen, HardDrive, Cloud } from "lucide-react";
import { createSdkFilesStore } from "@/features/files/sdkFilesStore";
import { createSdkFilesThumbnails } from "@/features/files/sdkFilesThumbnails";
import { SdkFilesPaneView } from "@/features/files/SdkFilesPaneView";
import {
  imageMimeTypes,
  videoMimeTypes,
  audioMimeTypes,
} from "@/features/files/explorer/components/globalPreview/previewMediaTables";
import type { MistyFilePickerProps } from "./FilePicker";
import type { MistyFilePickerPreparedSelection } from "./preparePickerSelections";

/** The shared file list, backed by local and connected SDK grants. */
export function createSdkFilePicker(
  misty: MistyAppSDK,
  acceptFile: (file: File) => string,
  report: (error: unknown) => void,
) {
  return function Picker(props: MistyFilePickerProps) {
    const lifetime = useMemo(() => new AbortController(), []);
    const files = useMemo(() => createSdkFilesStore(misty, lifetime.signal), [lifetime]);
    const thumbnails = useMemo(
      () => createSdkFilesThumbnails(files, lifetime.signal),
      [files, lifetime],
    );
    const state = files.store();
    const [sources, setSources] = useState<readonly MistyFileSource[]>([]),
      [busy, setBusy] = useState(false);
    const latest = useRef(props);
    latest.current = props;
    const fail = (error: unknown) => {
      if (!lifetime.signal.aborted) {
        files.error(error);
        report(error);
      }
    };
    const open = async (source: MistyFileSource) => {
      const existing = files.store
        .getState()
        .folders.find((folder) => folder.source?.id === source.id);
      if (existing) return files.navigate(existing.root);
      const grant = await misty.files.openSource(source.id, { write: false });
      if (lifetime.signal.aborted) {
        await misty.files.release(grant.handle);
        return;
      }
      await files.openFolder({ directoryGrant: grant, source, write: false });
    };
    useEffect(() => {
      void misty.files
        .sources()
        .then(async (available) => {
          if (lifetime.signal.aborted) return;
          setSources(available);
          const home = available.find((source) => source.id === "local:home");
          if (home) await open(home);
        })
        .catch(fail);
      return () => {
        lifetime.abort();
        thumbnails.close();
        void files.close();
      };
    }, []);
    const select = async (entries: FileEntry[]) => {
      if (busy || !entries.length) return;
      setBusy(true);
      try {
        const prepared: MistyFilePickerPreparedSelection[] = [];
        for (const entry of props.multiple ? entries : entries.slice(0, 1)) {
          if (entry.kind !== "file") continue;
          if (
            props.allowedExtensions?.length &&
            !props.allowedExtensions.some(
              (extension) =>
                extension.replace(/^\./, "").toLowerCase() === entry.extension.toLowerCase(),
            )
          )
            continue;
          const bytes = await files.readBytes(entry.path, 128 * 1024 * 1024);
          if (lifetime.signal.aborted) return;
          const mime =
            entry.mimeType ||
            imageMimeTypes[entry.extension] ||
            videoMimeTypes[entry.extension] ||
            audioMimeTypes[entry.extension] ||
            (entry.extension === "pdf" ? "application/pdf" : "application/octet-stream");
          const path = acceptFile(new File([bytes], entry.name, { type: mime }));
          const folder = files.owner(entry.path),
            source = folder.source;
          prepared.push({
            localPath: path,
            ...(source?.kind === "remote"
              ? {
                  source: {
                    provider: source.providerType,
                    remoteName: source.name,
                    remotePath: entry.path.slice(folder.root.length + 1),
                  },
                }
              : {}),
          });
        }
        if (!prepared.length) throw new Error("Choose a supported file.");
        const current = latest.current;
        if (current.onSelectPreparedMany) current.onSelectPreparedMany(prepared);
        else if (current.onSelectMany) current.onSelectMany(prepared.map((item) => item.localPath));
        else current.onSelect(prepared[0].localPath);
      } catch (error) {
        fail(error);
      } finally {
        if (!lifetime.signal.aborted) setBusy(false);
      }
    };
    const content = (
      <div className="grid h-full min-h-0 grid-cols-[200px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
        <aside className="overflow-auto border-r border-charcoal-border p-2">
          <p className="px-2 py-2 text-sm font-medium">Local</p>
          {sources
            .filter((source) => source.kind === "local" || props.allowRemoteFiles)
            .map((source) => (
              <Button
                key={source.id}
                variant="ghost"
                className="w-full justify-start gap-2"
                disabled={!source.online || busy}
                onClick={() => void open(source).catch(fail)}
              >
                {source.kind === "remote" ? <Cloud size={16} /> : <HardDrive size={16} />}
                <span className="truncate">{source.name}</span>
              </Button>
            ))}
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start gap-2"
            onClick={() => void files.openFolder({ write: false }).catch(fail)}
          >
            <FolderOpen size={16} />
            Choose folder
          </Button>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-charcoal-border px-2">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!state.pane.listing?.parentPath}
              aria-label="Parent folder"
              onClick={() => void files.navigate(state.pane.listing!.parentPath!).catch(fail)}
            >
              <ArrowLeft size={16} />
            </Button>
            <span className="truncate text-sm">
              {state.pane.listing?.title ?? "Choose a folder"}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <SdkFilesPaneView
              files={files}
              paneId="sdk-picker"
              itemScale={1}
              directorySizes={{}}
              cutPaths={new Set()}
              runtime={{
                ...thumbnails,
                thumbnailPreviewsEnabled: true,
                compactModeEnabled: false,
                Error: ({ error }) => (
                  <p role="alert" className="p-3 text-sm">
                    {error}
                  </p>
                ),
              }}
              onOpenFile={(entry) => void select([entry])}
              onDropItems={async () => {}}
              menuEntries={() => []}
            />
          </div>
        </div>
        <footer className="col-span-2 flex items-center justify-end gap-2 border-t border-charcoal-border p-3">
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            disabled={busy || !files.selected().some((entry) => entry.kind === "file")}
            onClick={() => void select(files.selected())}
          >
            {busy ? "Preparing files…" : "Choose files"}
          </Button>
        </footer>
      </div>
    );
    if (props.embedded) return content;
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
      >
        <DialogContent className="grid h-[min(720px,calc(100vh-48px))] w-[min(1060px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
          <div className="border-b border-charcoal-border p-4">
            <DialogTitle>{props.title ?? "Choose files"}</DialogTitle>
            <DialogDescription className="sr-only">
              Browse local and connected files.
            </DialogDescription>
          </div>
          {content}
        </DialogContent>
      </Dialog>
    );
  };
}
