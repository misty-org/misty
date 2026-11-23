import { useAppStore } from "@/app/shell";
import { Button } from "@misty/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef } from "react";

export type MistyFilePickerMode = "file" | "folder";

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  embedded?: boolean;
  active?: boolean;
  multiple?: boolean;
  title?: string;
  allowedExtensions?: string[];
  onCancel: () => void;
  onSelect: (path: string) => void;
  onSelectMany?: (paths: string[]) => void;
}

function chooseLabel(mode: MistyFilePickerMode, multiple: boolean): string {
  if (mode === "folder") return multiple ? "Choose folders" : "Choose a folder";
  return multiple ? "Choose files" : "Choose a file";
}

export function MistyFilePicker({
  mode,
  embedded = false,
  multiple = false,
  title,
  allowedExtensions,
  onCancel,
  onSelect,
  onSelectMany,
}: MistyFilePickerProps) {
  const startingFolder = useAppStore((s) => s.app?.environment.homeDir) || undefined;

  const choose = async () => {
    const chosen = await open({
      title,
      directory: mode === "folder",
      multiple,
      defaultPath: startingFolder,
      filters: allowedExtensions?.length
        ? [{ name: "Files", extensions: allowedExtensions.map((ext) => ext.replace(/^\./, "")) }]
        : undefined,
    }).catch(() => null);
    const paths = chosen === null ? [] : Array.isArray(chosen) ? chosen : [chosen];
    if (paths.length && multiple && onSelectMany) onSelectMany(paths);
    else if (paths.length) onSelect(paths[0]);
    else if (!embedded) onCancel();
  };

  const opened = useRef(false);
  useEffect(() => {
    if (embedded || opened.current) return;
    opened.current = true;
    void choose();
    // One dialog per picker, however often its props change while that dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!embedded) return null;
  return (
    <div className="grid min-h-0 place-items-center p-6">
      <Button variant="secondary" onClick={() => void choose()}>
        {chooseLabel(mode, multiple)}
      </Button>
    </div>
  );
}
