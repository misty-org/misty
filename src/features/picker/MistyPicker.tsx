import { FolderOpen, LibraryBig } from "lucide-react";
import { useState } from "react";
import type { MistyPickerProps, MistyPickerSource } from "./model/interfaces/MistyPicker";
export type { MistyPickerProps, MistyPickerSource } from "./model/interfaces/MistyPicker";

import { MistyLibraryPicker } from "@/features/space-library";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/ui";
import { MistyFilePicker } from "./FilePicker";

const sharedPickerDialogClassName = [
  "grid h-[min(640px,calc(100vh-64px))] w-[min(760px,calc(100vw-32px))] max-w-none",
  "grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0",
  "max-[560px]:size-full max-[560px]:rounded-none",
].join(" ");

/**
 * One picker for both sources. Callers open this rather than choosing between a file
 * picker and a Library picker up front — the person picking decides where to look.
 */
export function MistyPicker({
  spaceId,
  initialSource = "files",
  fileMode = "file",
  multiple = false,
  title,
  allowedExtensions,
  librarySelectedIds = [],
  libraryMaximum = 5,
  onCancel,
  onChooseFiles,
  onChooseLibraryItems,
}: MistyPickerProps) {
  const libraryAvailable = Boolean(spaceId && onChooseLibraryItems);
  const [source, setSource] = useState<MistyPickerSource>(
    libraryAvailable ? initialSource : "files",
  );

  const sourceToggle = libraryAvailable ? (
    <ToggleGroup
      className="shrink-0 rounded-md bg-charcoal-card p-0.5"
      type="single"
      value={source}
      onValueChange={(value) => {
        if (value === "files" || value === "library") setSource(value);
      }}
      aria-label="Pick from"
    >
      <ToggleGroupItem className="h-7 gap-1.5 border-0 px-2.5 text-xs" value="files">
        <FolderOpen size={14} />
        Files
      </ToggleGroupItem>
      <ToggleGroupItem className="h-7 gap-1.5 border-0 px-2.5 text-xs" value="library">
        <LibraryBig size={14} />
        Library
      </ToggleGroupItem>
    </ToggleGroup>
  ) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className={sharedPickerDialogClassName}>
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-charcoal-border px-5 py-3 pr-14 text-left">
          <div className="min-w-0">
            <DialogTitle className="text-base">
              {source === "library"
                ? "Choose from Library"
                : title || (fileMode === "folder" ? "Choose a folder" : "Choose a file")}
            </DialogTitle>
            <DialogDescription>
              {source === "library"
                ? `Select up to ${libraryMaximum} items to reference.`
                : fileMode === "folder"
                  ? "Pick a destination folder."
                  : multiple
                    ? "Pick one or more files."
                    : "Pick a file."}
            </DialogDescription>
          </div>
          {sourceToggle}
        </DialogHeader>

        <div style={{ display: source === "files" ? "contents" : "none" }}>
          <MistyFilePicker
            embedded
            active={source === "files"}
            mode={fileMode}
            multiple={multiple}
            title={title}
            allowedExtensions={allowedExtensions}
            onCancel={onCancel}
            onSelect={(path) => onChooseFiles([path])}
            onSelectMany={(paths) => onChooseFiles(paths)}
          />
        </div>

        {libraryAvailable && spaceId && onChooseLibraryItems ? (
          <div style={{ display: source === "library" ? "contents" : "none" }}>
            <MistyLibraryPicker
              embedded
              active={source === "library"}
              spaceId={spaceId}
              selectedIds={librarySelectedIds}
              maximumSelected={libraryMaximum}
              onCancel={onCancel}
              onChoose={onChooseLibraryItems}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
