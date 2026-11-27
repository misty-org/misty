import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, lazyTool, ToolSuspense } from "@misty/ui";
import { messageOf } from "./format";
import { localPath, type FileItem, type FilesPlace } from "./model";

export interface FilePickChoice {
  title?: string;
  accept?: readonly string[];
  multiple?: boolean;
  folders?: boolean;
  local?: boolean;
  start?: FilesPlace;
}

const FilePickBody = lazyTool(() => import("./FilePickBody"));

/**
 * Misty's own file picker: Files in a dialog, picking from this computer, the person's projects and
 * every Space's drive. It hands back the picked items (`onPick`) or, with `folders`, the folder's path
 * (`onPickFolder`); whatever they turn into is the caller's, which may throw to say it failed.
 */
export function FilePickDialog({
  choice,
  onPick,
  onPickFolder,
  onCancel,
}: {
  choice: FilePickChoice;
  onPick(items: FileItem[]): Promise<void> | void;
  onPickFolder?(path: string): Promise<void> | void;
  onCancel(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const run = async (work: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await work();
    } catch (cause) {
      setFailure(messageOf(cause, "Misty couldn't open that."));
      setBusy(false);
    }
  };
  const pick = (items: FileItem[]) => {
    const files = items.filter((item) => !item.folder);
    if (!files.length) return;
    if (choice.local && !files.every((item) => localPath(item))) return;
    void run(() => onPick(choice.multiple ? files : files.slice(0, 1)));
  };
  const pickFolder = (path: string) => void run(() => onPickFolder?.(path));

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && !busy && onCancel()}>
      <DialogContent
        size="xl"
        layout="scroll"
        tone="page"
        aria-describedby={undefined}
        className="h-[min(--spacing(160),calc(100dvh-var(--spacing)*16))]"
      >
        <DialogTitle className="sr-only">
          {choice.title || (choice.folders ? "Choose a folder" : "Choose a file")}
        </DialogTitle>
        <ToolSuspense tool="files" label="Setting up Files">
          <FilePickBody
            choice={choice}
            busy={busy}
            failure={failure}
            onPick={pick}
            onPickFolder={pickFolder}
            onCancel={onCancel}
          />
        </ToolSuspense>
      </DialogContent>
    </Dialog>
  );
}
