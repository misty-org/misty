import { Clapperboard, FolderOpen } from "lucide-react";
import { useState, type ComponentType } from "react";
import type { MistyPickerProps, MistyPickerSource } from "./mistyPickerOptions";
import { LibraryPickerPanel } from "./LibraryPickerSeam";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ChoiceGroup,
  Surface,
} from "@misty/ui";
import type { MistyFilePickerProps } from "./FilePicker";

const sharedPickerDialogClassName = [
  "grid h-[min(45rem,calc(100vh-3rem))] w-[min(66.25rem,calc(100vw-2rem))] max-w-none",
  "gap-0 overflow-hidden p-0 shadow-2xl",
  "max-[616px]:size-full max-[616px]:rounded-none",
].join(" ");

/**
 * One picker for both sources. Callers open this rather than choosing between a file
 * picker and a Library picker up front — the person picking decides where to look.
 */
export function MistyPickerShell({
  FilePickerComponent: MistyFilePicker,
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
}: MistyPickerProps & { FilePickerComponent: ComponentType<MistyFilePickerProps> }) {
  const libraryAvailable = Boolean(spaceId && onChooseLibraryItems);
  const [source, setSource] = useState<MistyPickerSource>(
    libraryAvailable ? initialSource : "files",
  );

  // With nothing else to offer, there's no reason to show a dialog before the system's own.
  if (!libraryAvailable) {
    return (
      <MistyFilePicker
        mode={fileMode}
        multiple={multiple}
        title={title}
        allowedExtensions={allowedExtensions}
        onCancel={onCancel}
        onSelect={(path) => onChooseFiles([path])}
        onSelectMany={(paths) => onChooseFiles(paths)}
      />
    );
  }

  const sourceToggle = (
    <ChoiceGroup<MistyPickerSource>
      className="shrink-0"
      label="Pick from"
      value={source}
      onChange={setSource}
      options={[
        { value: "files", label: "Files", icon: FolderOpen },
        { value: "library", label: "Media", icon: Clapperboard },
      ]}
    />
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent aria-describedby={undefined} className={sharedPickerDialogClassName}>
        {/* The picker sits on the page's own fill, not the dialog's card. */}
        <Surface tone="page" className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader className="flex-row items-center justify-between gap-4 border-b px-5 py-3 pr-14 text-left">
            <div className="min-w-0">
              <DialogTitle className="text-base">
                {source === "library"
                  ? "Choose from Media"
                  : title || (fileMode === "folder" ? "Choose a folder" : "Choose a file")}
              </DialogTitle>
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

          {spaceId && onChooseLibraryItems ? (
            // Its search bar, grid and footer are three rows of their own inside the body row.
            <div
              className="min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
              style={{ display: source === "library" ? "grid" : "none" }}
            >
              <LibraryPickerPanel
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
        </Surface>
      </DialogContent>
    </Dialog>
  );
}
