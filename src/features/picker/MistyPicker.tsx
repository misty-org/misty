import type {
  MistyPickerProps,
  MistyPickerSource,
} from "@/models/interfaces/features/picker/MistyPicker";
export type {
  MistyPickerProps,
  MistyPickerSource,
} from "@/models/interfaces/features/picker/MistyPicker";
import { useState } from "react";
import { FolderOpen, LibraryBig } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/ui";
import { MistyLibraryPicker } from "@/features/spaces/components/MistyLibraryPicker";
import { MistyFilePicker } from "./FilePicker";

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
      className="shrink-0 rounded-md bg-muted/60 p-0.5"
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

  if (source === "library" && spaceId && onChooseLibraryItems) {
    return (
      <MistyLibraryPicker
        spaceId={spaceId}
        selectedIds={librarySelectedIds}
        maximumSelected={libraryMaximum}
        sourceToggle={sourceToggle}
        onCancel={onCancel}
        onChoose={onChooseLibraryItems}
      />
    );
  }

  return (
    <MistyFilePicker
      mode={fileMode}
      multiple={multiple}
      title={title}
      allowedExtensions={allowedExtensions}
      sourceToggle={sourceToggle}
      onCancel={onCancel}
      onSelect={(path) => onChooseFiles([path])}
      onSelectMany={(paths) => onChooseFiles(paths)}
    />
  );
}
