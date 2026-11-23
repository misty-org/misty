import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  SetupState,
  Spinner,
  Text,
} from "@misty/ui";
import { disk } from "@/features/files";
import { FilesBrowser } from "../../file-manager";
import type { FileItem } from "../../file-manager/model";
import type { AppFileRef } from "../space_app_files";
import { appFilesFor } from "./chosen_files";

const messageOf = (reason: unknown) =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";

function PickerFooter({
  picked,
  open,
  busy,
  failure,
  onPick,
  onCancel,
}: {
  picked: FileItem[];
  open(item: FileItem): void;
  busy: boolean;
  failure: string;
  onPick(items: FileItem[]): void;
  onCancel(): void;
}) {
  const files = picked.filter((item) => !item.folder);
  const folder = picked.length === 1 && picked[0].folder ? picked[0] : undefined;
  return (
    <DialogFooter className="px-6 pb-5 pt-3">
      <div className="mr-auto flex min-w-0 items-center gap-2">
        {busy ? <Spinner label="Adding files" /> : null}
        {failure ? (
          <Text tone="danger" role="alert">
            {failure}
          </Text>
        ) : null}
      </div>
      <Button variant="quiet" size="lg" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="lg"
        disabled={busy || (!folder && files.length === 0)}
        onClick={() => (folder ? open(folder) : onPick(files))}
      >
        Open
      </Button>
    </DialogFooter>
  );
}

export function FilePickerDialog({
  spaceId,
  appName,
  accept = [],
  multiple,
  onPick,
  onCancel,
}: {
  spaceId: string;
  appName: string;
  accept?: string[];
  multiple: boolean;
  onPick(files: AppFileRef[]): void;
  onCancel(): void;
}) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    let live = true;
    void disk.granted().then(
      (on) => live && setGranted(on),
      () => live && setGranted(false),
    );
    return () => {
      live = false;
    };
  }, []);

  const pick = async (items: FileItem[]) => {
    const files = items.filter((item) => !item.folder);
    if (busy || !files.length) return;
    setBusy(true);
    setFailure("");
    try {
      onPick(await appFilesFor(spaceId, multiple ? files : files.slice(0, 1), appName));
    } catch (reason) {
      setFailure(messageOf(reason) || "The files couldn't be added.");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && !busy && onCancel()}>
      <DialogContent
        size="xl"
        layout="scroll"
        tone="page"
        aria-describedby={undefined}
        className="h-[min(--spacing(160),calc(100dvh-var(--spacing)*16))] gap-0 p-0"
      >
        <DialogTitle className="sr-only">{`Open in ${appName}`}</DialogTitle>
        {granted === null ? (
          <SetupState tool="files" label="Checking access to your files" />
        ) : (
          <FilesBrowser
            granted={granted}
            start={{ kind: "space-drive", spaceId, path: "/" }}
            pick={{ accept, multiple, onPick: (items) => void pick(items) }}
            footer={(picked, open) => (
              <PickerFooter
                picked={picked}
                open={open}
                busy={busy}
                failure={failure}
                onPick={(items) => void pick(items)}
                onCancel={onCancel}
              />
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
