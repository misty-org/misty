import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FileInput,
  IconButton,
  MenuItem,
  MenuSeparator,
  useNotice,
} from "@/shared/ui";
import { FileDown, FileUp, History, MoreHorizontal, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { HistoryDialog } from "../../../history/HistoryDialog";
import type { SpaceDrawing } from "../drawingTypes";

/** An open whiteboard's ⋯ menu: version history, `.excalidraw` export and import, and delete. */
export function DrawingActionsMenu(props: {
  drawing: SpaceDrawing;
  onDelete?: () => void;
  /** Opens a whiteboard made here (an imported file). */
  onOpenDrawing?: (drawingId: string) => void;
}) {
  const { drawing } = props;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  useNotice(Boolean(failure), {
    message: failure,
    tone: "error",
    onDismiss: () => setFailure(""),
  });
  const title = drawing.title || "Untitled whiteboard";

  const exportFile = async () => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const { exportDrawingFile } = await import("../excalidrawFile");
      await exportDrawingFile(drawing.space_id, drawing.id, title);
    } catch {
      setFailure("The whiteboard couldn’t be exported. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setFailure("");
    try {
      const { importExcalidrawFile, ExcalidrawFileError } = await import("../excalidrawFile");
      try {
        const created = await importExcalidrawFile(drawing.space_id, file);
        props.onOpenDrawing?.(created.id);
      } catch (error) {
        setFailure(
          error instanceof ExcalidrawFileError
            ? error.message
            : "The file couldn’t be imported. Try again.",
        );
      }
    } catch {
      setFailure("The file couldn’t be imported. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${title}`}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width="md">
          <MenuItem icon={History} label="Version history" onSelect={() => setHistoryOpen(true)} />
          <MenuItem
            icon={FileDown}
            label="Export as Excalidraw file"
            disabled={busy}
            onSelect={() => void exportFile()}
          />
          {props.onOpenDrawing ? (
            <MenuItem
              icon={FileUp}
              label="Import Excalidraw file"
              disabled={busy}
              onSelect={() => fileRef.current?.click()}
            />
          ) : null}
          {props.onDelete && drawing.can_delete ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete" danger onSelect={props.onDelete} />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <FileInput
        ref={fileRef}
        accept=".excalidraw,.json,application/vnd.excalidraw+json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void importFile(file);
        }}
      />
      <HistoryDialog
        spaceId={drawing.space_id}
        kind="drawings"
        itemId={drawing.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </>
  );
}
