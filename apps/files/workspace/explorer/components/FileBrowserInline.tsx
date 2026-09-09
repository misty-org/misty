import { Input, TableCell, TableRow } from "@/shared/ui";
import { useLayoutEffect, useRef } from "react";
import type { PassiveRenameDraft } from "../model/types/components/FileBrowserInline";
import type { ExplorerInlineEditState, ExplorerSortColumn } from "../store";
import { FileNameIcon } from "./FileBrowserIcons";
import { fileBrowserStyles } from "./FileBrowserStyles";
export type { PassiveRenameDraft } from "../model/types/components/FileBrowserInline";

export function InlineCreateTableRow(props: {
  edit: ExplorerInlineEditState;
  columns: ExplorerSortColumn[];
  hasFillerColumn: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <TableRow className={fileBrowserStyles.tableRow} data-state="selected">
      {props.columns.map((column) => {
        if (column === "name") {
          return (
            <TableCell
              className={`${fileBrowserStyles.tableNameCell} ${fileBrowserStyles.tableNameCellEditing}`}
              key={column}
            >
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <FileNameIcon
                  name={props.edit.value}
                  kind={props.edit.itemKind === "folder" ? "folder" : "file"}
                  size={20}
                />
                <InlineNameEditor {...props} variant="table" />
              </span>
            </TableCell>
          );
        }
        if (column === "type")
          return (
            <TableCell className={fileBrowserStyles.tableCell} key={column}>
              {props.edit.itemKind === "folder" ? "Folder" : "File"}
            </TableCell>
          );
        return (
          <TableCell className={fileBrowserStyles.tableCell} key={column}>
            --
          </TableCell>
        );
      })}
      {props.hasFillerColumn ? (
        <TableCell className={fileBrowserStyles.tableFillerCell} aria-hidden="true" />
      ) : null}
    </TableRow>
  );
}

export function InlineNameEditor(props: {
  edit: ExplorerInlineEditState;
  variant?: "table" | "grid";
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionKey = `${props.edit.paneId}:${props.edit.kind}:${props.edit.entryId ?? "new"}:${props.edit.originalName}`;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
  }, [sessionKey]);

  return (
    <span
      className={[
        fileBrowserStyles.inlineEditor,
        props.variant === "grid" ? fileBrowserStyles.inlineEditorGrid : "",
        props.edit.error ? fileBrowserStyles.inlineEditorInvalid : "",
      ].join(" ")}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className={[
          fileBrowserStyles.inlineFields,
          props.variant === "grid" ? fileBrowserStyles.inlineFieldsGrid : "",
          props.edit.error ? fileBrowserStyles.inlineFieldsInvalid : "",
          props.edit.error && props.variant === "table"
            ? fileBrowserStyles.inlineFieldsInvalidTable
            : "",
        ].join(" ")}
      >
        <Input
          className={fileBrowserStyles.inlineInput}
          ref={inputRef}
          aria-label={props.edit.kind === "create" ? "New item name" : "Rename item"}
          value={props.edit.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              props.onCommit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onCancel();
            }
          }}
        />
        {props.edit.lockedExtension ? (
          <span className={fileBrowserStyles.lockedExtension}>{props.edit.lockedExtension}</span>
        ) : null}
      </span>
    </span>
  );
}

export function PassiveRenameDraftView(props: { draft: PassiveRenameDraft }) {
  return (
    <span
      className={`${fileBrowserStyles.passiveDraft} ${props.draft.error ? fileBrowserStyles.passiveDraftInvalid : ""}`}
      title={props.draft.error ?? undefined}
    >
      <span className={fileBrowserStyles.passiveDraftText}>{props.draft.value || " "}</span>
      {props.draft.lockedExtension ? (
        <small className={fileBrowserStyles.passiveDraftExtension}>
          {props.draft.lockedExtension}
        </small>
      ) : null}
      <i className={fileBrowserStyles.passiveDraftCaret} aria-hidden="true" />
    </span>
  );
}
