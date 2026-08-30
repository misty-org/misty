import { useProvidersStore } from "@/features/providers";
import { SystemErrorActivity } from "@/features/activity";
import FilesPage, { formatBytes, useExplorerStore } from "@/features/files/explorer";
import { useMultiPanelStore } from "@/features/workspace";
import { explorerPrepareOpenItem } from "@/features/files/native";
import type { FileEntry } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";
import { Check, Folder, FileText, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  preparePickerSelections,
  type MistyFilePickerPreparedSelection,
} from "./preparePickerSelections";

export type MistyFilePickerMode = "file" | "folder";

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  embedded?: boolean;
  active?: boolean;
  multiple?: boolean;
  title?: string;
  initialPath?: string | null;
  allowedExtensions?: string[];
  sourceToggle?: ReactNode;
  allowRemoteFiles?: boolean;
  onCancel: () => void;
  onSelect: (path: string) => void;
  onSelectMany?: (paths: string[]) => void;
  onSelectPreparedMany?: (selection: MistyFilePickerPreparedSelection[]) => void;
}

const standaloneDialogClassName = [
  "grid h-[min(720px,calc(100vh-48px))] w-[min(1060px,calc(100vw-32px))] max-w-none",
  "grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0",
  "rounded-xl bg-charcoal-workspace border border-charcoal-border shadow-2xl",
  "max-[560px]:size-full max-[560px]:rounded-none",
].join(" ");

export function MistyFilePicker({
  mode,
  embedded = false,
  multiple = false,
  title,
  allowedExtensions,
  sourceToggle,
  allowRemoteFiles = false,
  onCancel,
  onSelect,
  onSelectMany,
  onSelectPreparedMany,
}: MistyFilePickerProps) {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const pane = useExplorerStore(useShallow((state) => state.panes[activePaneId]));
  const remotes = useProvidersStore((state) => state.providers?.remotes ?? []);

  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePath = pane?.listing?.path ?? "";
  const selectedEntries = useMemo(() => {
    const allEntries = pane?.listing?.entries ?? [];
    return (pane?.selectedIds ?? [])
      .map((id) => allEntries.find((entry) => entry.id === id))
      .filter((entry): entry is FileEntry => Boolean(entry));
  }, [pane?.listing?.entries, pane?.selectedIds]);

  const selectableExtensions = useMemo(() => {
    if (!allowedExtensions?.length) return null;
    return new Set(allowedExtensions.map((ext) => ext.toLowerCase().replace(/^\./, "")));
  }, [allowedExtensions]);

  const isValidFileEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.kind !== "file") return false;
      if (entry.location.kind !== "local" && !allowRemoteFiles) return false;
      if (!selectableExtensions) return true;
      return selectableExtensions.has(entry.extension.toLowerCase().replace(/^\./, ""));
    },
    [allowRemoteFiles, selectableExtensions],
  );

  const selectedFiles = useMemo(
    () => selectedEntries.filter(isValidFileEntry),
    [isValidFileEntry, selectedEntries],
  );

  const selectedFolder = useMemo(
    () => selectedEntries.find((entry) => entry.kind === "folder"),
    [selectedEntries],
  );

  const canChoose = useMemo(() => {
    if (preparing) return false;
    if (mode === "folder") {
      return Boolean(selectedFolder?.path || activePath);
    }
    if (multiple) {
      return selectedFiles.length > 0;
    }
    return selectedFiles.length === 1;
  }, [activePath, mode, multiple, preparing, selectedFiles.length, selectedFolder?.path]);

  const handleChoose = async () => {
    if (!canChoose) return;
    setError(null);

    if (mode === "folder") {
      const targetFolder = selectedFolder?.path || activePath;
      if (targetFolder) {
        onSelect(targetFolder);
      }
      return;
    }

    const chosen = multiple ? selectedFiles : selectedFiles.slice(0, 1);
    if (chosen.length === 0) return;

    setPreparing(true);
    try {
      const prepared = await preparePickerSelections(chosen, remotes, async (entry) => {
        const local = await explorerPrepareOpenItem({
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          remoteModified: entry.remoteModified,
        });
        return local.localPath;
      });

      if (onSelectPreparedMany) {
        onSelectPreparedMany(prepared);
      } else if (multiple && onSelectMany) {
        onSelectMany(prepared.map((item) => item.localPath));
      } else if (prepared[0]) {
        onSelect(prepared[0].localPath);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPreparing(false);
    }
  };

  const selectionSummary = useMemo(() => {
    if (mode === "folder") {
      const path = selectedFolder?.path || activePath;
      return path ? (
        <div className="flex items-center gap-2 text-xs text-cream min-w-0">
          <Folder size={14} className="text-sage-fg shrink-0" />
          <span className="truncate font-mono text-xs">{path}</span>
        </div>
      ) : (
        <span className="text-xs text-cream-muted">Browse and choose a folder</span>
      );
    }

    if (selectedFiles.length === 0) {
      return (
        <div className="flex items-center gap-2 text-xs text-cream-muted min-w-0">
          <FileText size={14} className="shrink-0" />
          <span>
            {selectableExtensions
              ? `Select ${Array.from(selectableExtensions)
                  .map((e) => `.${e}`)
                  .join(", ")} file${multiple ? "s" : ""}`
              : `Select a file${multiple ? " or files" : ""}…`}
          </span>
        </div>
      );
    }

    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      return (
        <div className="flex items-center gap-2 text-xs text-cream min-w-0">
          <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[10px]">
            {file.extension ? file.extension.toUpperCase() : "File"}
          </Badge>
          <span className="truncate font-medium">{file.name}</span>
          <span className="text-cream-muted">({formatBytes(file.sizeBytes)})</span>
        </div>
      );
    }

    const totalBytes = selectedFiles.reduce((acc, f) => acc + (f.sizeBytes ?? 0), 0);
    return (
      <div className="flex items-center gap-2 text-xs text-cream min-w-0">
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {selectedFiles.length} selected
        </Badge>
        <span className="text-cream-muted font-medium">Total {formatBytes(totalBytes)}</span>
      </div>
    );
  }, [activePath, mode, multiple, selectableExtensions, selectedFiles, selectedFolder?.path]);

  const bottomActionBar = (
    <footer className="flex items-center justify-between gap-4 border-t border-charcoal-border bg-charcoal-card/80 px-4 py-3 shrink-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {selectionSummary}
        {error ? (
          <SystemErrorActivity
            error={error}
            scope="file-picker:prepare"
            title="File selection failed"
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={preparing}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!canChoose}
          onClick={() => void handleChoose()}
          className="gap-1.5 min-w-[90px]"
        >
          {preparing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Check size={14} />
              {mode === "folder"
                ? "Choose Folder"
                : multiple && selectedFiles.length > 1
                  ? `Choose (${selectedFiles.length})`
                  : "Choose"}
            </>
          )}
        </Button>
      </div>
    </footer>
  );

  const pickerContent = (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-charcoal-workspace">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <FilesPage embedded />
      </div>
      {bottomActionBar}
    </div>
  );

  if (embedded) {
    return pickerContent;
  }

  const defaultTitle =
    mode === "folder" ? "Choose a Folder" : multiple ? "Choose Files" : "Choose a File";
  const dialogTitle = title || defaultTitle;

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className={standaloneDialogClassName}>
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-charcoal-border px-5 py-3 pr-12 text-left shrink-0">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-xs text-cream-muted">
              {mode === "folder"
                ? "Select a destination folder."
                : multiple
                  ? "Select one or more files."
                  : "Select a file."}
            </DialogDescription>
          </div>
          {sourceToggle}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="relative size-full overflow-hidden">
            <FilesPage embedded />
          </div>
        </div>

        {bottomActionBar}
      </DialogContent>
    </Dialog>
  );
}
