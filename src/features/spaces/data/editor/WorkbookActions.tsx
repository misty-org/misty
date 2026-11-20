import { FileDown, FileSpreadsheet, History, MoreHorizontal, Trash2 } from "lucide-react";
import type * as Y from "yjs";
import {
  Avatar,
  AvatarFallback,
  ConfirmDeleteDialog,
  DropdownMenu,
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  RenameItemDialog,
  Text,
  Tooltip,
  notify,
} from "@misty/ui";
import { personInitials } from "@/shared/lib/personInitials";
import {
  exportFilename,
  exportSheetCsv,
  exportWorkbookXlsx,
  saveBlob,
} from "../export/workbookExport";
import { deleteSheetTab, renameSheetTab } from "../grid/gridEdits";
import type { WorkbookPresenceUser } from "../useWorkbookRoom";

/** Shows why something failed, in its own words when it has them. */
export function failed(error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message.replace(/^Op \d+ \([^)]*\): /, "") : "";
  notify({ message: message || fallback, tone: "error" });
}

export async function saveWorkbookXlsx(doc: Y.Doc, title: string): Promise<void> {
  try {
    saveBlob(await exportWorkbookXlsx(doc), exportFilename(title, "xlsx"));
  } catch (error) {
    failed(error, "The workbook couldn't be exported.");
  }
}

export function saveSheetCsv(doc: Y.Doc, title: string, sheet: { id: string; name: string }): void {
  try {
    const csv = exportSheetCsv(doc, sheet.id);
    saveBlob(
      new Blob([csv], { type: "text/csv" }),
      exportFilename(`${title} - ${sheet.name}`, "csv"),
    );
  } catch (error) {
    failed(error, "The sheet couldn't be exported.");
  }
}

/** The workbook's ⋯: export, history and delete. */
export function WorkbookActions(props: {
  canDelete: boolean;
  onExportXlsx(): void;
  onExportCsv?: () => void;
  onHistory(): void;
  onDelete(): void;
}) {
  return (
    <DropdownMenu>
      <MenuTrigger label="Data actions" icon={MoreHorizontal} iconOnly />
      <DropdownMenuContent align="end" width="md">
        <MenuItem icon={FileSpreadsheet} label="Export as Excel" onSelect={props.onExportXlsx} />
        {props.onExportCsv ? (
          <MenuItem icon={FileDown} label="Export sheet as CSV" onSelect={props.onExportCsv} />
        ) : null}
        <MenuItem icon={History} label="History" onSelect={props.onHistory} />
        {props.canDelete ? (
          <>
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" danger onSelect={props.onDelete} />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Who else has the workbook open, by their initials. */
export function PeopleHere(props: { people: readonly WorkbookPresenceUser[] }) {
  const { people } = props;
  if (!people.length) return null;
  return (
    <div className="flex items-center -space-x-1.5" aria-label="People here">
      {people.slice(0, 4).map((person) => (
        <Tooltip key={person.id} content={person.name}>
          <Avatar size="sm">
            <AvatarFallback>{personInitials(person.name)}</AvatarFallback>
          </Avatar>
        </Tooltip>
      ))}
      {people.length > 4 ? (
        <Text size="caption" tone="muted" className="pl-2.5">
          +{people.length - 4}
        </Text>
      ) : null}
    </div>
  );
}

/** Renaming and deleting a sheet, from its tab's right-click. */
export function SheetDialogs(props: {
  doc: Y.Doc;
  sheets: ReadonlyArray<{ id: string; name: string }>;
  renaming: string | null;
  deleting: string | null;
  onDone(): void;
}) {
  const { doc, renaming, deleting } = props;
  const nameOf = (id: string | null) => props.sheets.find((sheet) => sheet.id === id)?.name ?? "";
  return (
    <>
      {renaming ? (
        <RenameItemDialog
          key={renaming}
          title="Rename sheet"
          initialName={nameOf(renaming)}
          onConfirm={async (name) => renameSheetTab(doc, renaming, name)}
          onClose={props.onDone}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && props.onDone()}
        title={`Delete "${nameOf(deleting) || "sheet"}"?`}
        what="Its cells and the charts made from it are deleted. Formulas reading it show #REF!."
        onConfirm={() => {
          if (deleting) deleteSheetTab(doc, deleting);
          props.onDone();
        }}
      />
    </>
  );
}
