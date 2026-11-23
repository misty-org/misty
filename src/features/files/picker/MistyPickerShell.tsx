import { Monitor } from "lucide-react";
import { useState, type ComponentType } from "react";
import type { MistyPickerProps, MistyPickerSource } from "./misty_picker_options";
import { DrivePickerPanel } from "./DrivePickerSeam";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ChoiceGroup,
  Surface,
  spaceIcons,
} from "@misty/ui";
import type { MistyFilePickerProps } from "./FilePicker";

const sharedPickerDialogClassName = [
  "grid h-[min(--spacing(180),calc(100vh-var(--spacing)*12))] w-[min(--spacing(265),calc(100vw-var(--spacing)*8))] max-w-none",
  "gap-0 overflow-hidden p-0",
  "max-[616px]:size-full max-[616px]:rounded-none",
].join(" ");

export function MistyPickerShell({
  FilePickerComponent: MistyFilePicker,
  spaceId,
  initialSource = "files",
  fileMode = "file",
  multiple = false,
  title,
  allowedExtensions,
  driveMaximum = 5,
  onCancel,
  onChooseFiles,
  onChooseDriveFiles,
}: MistyPickerProps & { FilePickerComponent: ComponentType<MistyFilePickerProps> }) {
  const driveAvailable = Boolean(spaceId && onChooseDriveFiles);
  const [source, setSource] = useState<MistyPickerSource>(driveAvailable ? initialSource : "files");

  if (!driveAvailable) {
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
        { value: "files", label: "This computer", icon: Monitor },
        { value: "space", label: "Files", icon: spaceIcons.files },
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
        <Surface tone="page" className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader className="flex-row items-center justify-between gap-4 border-b px-5 py-3 pr-14 text-left">
            <div className="min-w-0">
              <DialogTitle>
                {source === "space"
                  ? "Choose from Files"
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

          {spaceId && onChooseDriveFiles ? (
            <div
              className="min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
              style={{ display: source === "space" ? "grid" : "none" }}
            >
              <DrivePickerPanel
                active={source === "space"}
                spaceId={spaceId}
                maximumSelected={driveMaximum}
                onCancel={onCancel}
                onChoose={onChooseDriveFiles}
              />
            </div>
          ) : null}
        </Surface>
      </DialogContent>
    </Dialog>
  );
}
