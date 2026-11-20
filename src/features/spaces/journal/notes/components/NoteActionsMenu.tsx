import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  spaceMadeKind,
  useNotice,
} from "@misty/ui";
import { Download, History, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { HistoryDialog } from "../../../history/HistoryDialog";
import type { NoteExportFormat } from "../export/noteExport";
import type { UnifiedNote } from "../noteTypes";

const exportChoices: Array<{ format: NoteExportFormat; label: string }> = [
  { format: "markdown", label: "Markdown" },
  { format: "docx", label: "Word document" },
  { format: "pdf", label: "PDF" },
];

/** An open doc's ⋯ menu: version history, export, slides from it, and delete. */
export function NoteActionsMenu(props: {
  note: UnifiedNote;
  spaceId: string;
  onDelete?: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [making, setMaking] = useState(false);
  const [failure, setFailure] = useState("");
  useNotice(Boolean(failure), {
    message: failure,
    tone: "error",
    onDismiss: () => setFailure(""),
  });
  const title = props.note.title || "Untitled doc";

  const exportAs = async (format: NoteExportFormat) => {
    if (exporting) return;
    setExporting(true);
    setFailure("");
    try {
      const { exportNote } = await import("../export/noteExport");
      await exportNote(props.spaceId, props.note.sourceId, format, title);
    } catch {
      setFailure("The doc couldn’t be exported. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const makeSlides = async () => {
    if (making) return;
    setMaking(true);
    setFailure("");
    try {
      const { slidesFromDoc } = await import("@/features/spaces/slides");
      await slidesFromDoc(props.spaceId, props.note.sourceId);
    } catch {
      setFailure("Slides couldn’t be made from this doc. Try again.");
    } finally {
      setMaking(false);
    }
  };

  const SlidesIcon = spaceMadeKind("deck").icon;
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
          <MenuSubmenu icon={Download} label="Export" disabled={exporting}>
            {exportChoices.map((choice) => (
              <MenuItem
                key={choice.format}
                label={choice.label}
                disabled={exporting}
                onSelect={() => void exportAs(choice.format)}
              />
            ))}
          </MenuSubmenu>
          <MenuItem
            icon={SlidesIcon}
            label="Make slides from this doc"
            disabled={making}
            onSelect={() => void makeSlides()}
          />
          {props.onDelete && props.note.canDelete ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete" danger onSelect={props.onDelete} />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <HistoryDialog
        spaceId={props.spaceId}
        kind="notes"
        itemId={props.note.sourceId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </>
  );
}
