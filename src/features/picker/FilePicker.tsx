import { useAppStore } from "@/features/app-shell";
import { selectGeneralPreferences, useSettingsStore } from "@/features/settings";
import { Button } from "@/shared/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef } from "react";
import { resolvePreferredRoot } from "./filePickerPaths";

export type MistyFilePickerMode = "file" | "folder";

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  /** Inside the Files/Library picker: a button, since the system dialog opens on top of it. */
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

/**
 * Picks files through the system's own dialog, the one thing that grants a file: what it returns
 * is the only thing Misty's windows can then read (`docs/browser/security.md`). Misty has no view of
 * a person's folders of its own.
 */
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
  const homeDir = useAppStore((s) => s.app?.environment.homeDir);
  const preferences = useSettingsStore((s) => s.settings?.document);
  const startingFolder = homeDir
    ? resolvePreferredRoot(selectGeneralPreferences(preferences).preferredWorkspaceRoot, homeDir)
    : undefined;

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
    // Inside the Files/Library picker, the person can still choose from the Library.
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
      <Button variant="outline" onClick={() => void choose()}>
        {chooseLabel(mode, multiple)}
      </Button>
    </div>
  );
}
