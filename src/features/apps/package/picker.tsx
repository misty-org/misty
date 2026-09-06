import type { MistyFilePickerProps } from "@/features/picker/FilePicker";
import type { MistyPickerProps } from "@/features/picker/MistyPicker";
import { MistyPickerShell } from "@/features/picker/MistyPickerShell";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";
import { registerSelectedFile } from "./selectedFiles";
export * from "@/features/picker/filePickerHelpers";
export type { MistyFilePickerProps, MistyFilePickerMode } from "@/features/picker/FilePicker";
export type {
  MistyPickerProps,
  MistyPickerSource,
} from "@/features/picker/MistyPicker";

export function MistyFilePicker(props: MistyFilePickerProps) {
  const content = (
    <div className="grid content-start gap-4 p-5">
      {props.mode === "folder" ? (
        <p>Choose destination folders in the Files app.</p>
      ) : (
        <>
          <label className="grid gap-3 text-sm">
            Choose files from your device
            <input
              type="file"
              multiple={props.multiple}
              accept={props.allowedExtensions?.map((ext) => `.${ext.replace(/^\./, "")}`).join(",")}
              onChange={(event) => {
                const paths = Array.from(event.target.files ?? []).map(registerSelectedFile);
                if (!paths.length) return;
                if (props.onSelectPreparedMany)
                  props.onSelectPreparedMany(paths.map((localPath) => ({ localPath })));
                else if (props.multiple && props.onSelectMany) props.onSelectMany(paths);
                else props.onSelect(paths[0]);
              }}
            />
          </label>
        </>
      )}
      <Button variant="outline" onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
  return props.embedded ? (
    content
  ) : (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title || "Choose files"}</DialogTitle>
          <DialogDescription>Select files to use in this App.</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

export function MistyPicker(props: MistyPickerProps) {
  return <MistyPickerShell {...props} FilePickerComponent={MistyFilePicker} />;
}
