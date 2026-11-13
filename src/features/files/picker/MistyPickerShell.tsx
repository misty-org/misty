import { FolderOpen, LibraryBig } from "lucide-react";
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
} from "@/shared/ui";
import type { MistyFilePickerProps } from "./FilePicker";

const sharedPickerDialogClassName = [
  "grid h-[min(720px,calc(100vh-48px))] w-[min(1060px,calc(100vw-32px))] max-w-none",
  "gap-0 overflow-hidden p-0 shadow-2xl",
  "max-[560px]:size-full max-[560px]:rounded-none",
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
        { value: "library", label: "Library", icon: LibraryBig },
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
                  ? "Choose from Library"
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
            <div style={{ display: source === "library" ? "contents" : "none" }}>
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
