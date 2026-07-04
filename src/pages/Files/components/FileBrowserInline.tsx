import { useLayoutEffect, useRef } from "react";
import type { FileEntry } from "../../../api/types";
import type { ExplorerInlineEditState, ExplorerSortColumn } from "../../../stores/useExplorerStore";
import { FileIcon } from "./FileBrowserIcons";
import { fileBrowserStyles } from "./FileBrowserStyles";

export type PassiveRenameDraft = {
  value: string;
  lockedExtension: string;
  error: string | null;
};

export function InlineCreateTableRow(props: {
  edit: ExplorerInlineEditState;
  columns: ExplorerSortColumn[];
  hasFillerColumn: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const entry = {
    kind: props.edit.itemKind === "folder" ? "folder" : "file",
  } as FileEntry;
  return (
    <tr className={`${fileBrowserStyles.tableRow} ${fileBrowserStyles.tableRowSelected}`}>
      {props.columns.map((column) => {
        if (column === "name") {
          return (
            <td className={`${fileBrowserStyles.tableNameCell} ${fileBrowserStyles.tableNameCellEditing}`} key={column}>
              <FileIcon entry={entry} />
              <InlineNameEditor {...props} variant="table" />
            </td>
          );
        }
        if (column === "type") return <td className={fileBrowserStyles.tableCell} key={column}>{props.edit.itemKind === "folder" ? "Folder" : "File"}</td>;
        return <td className={fileBrowserStyles.tableCell} key={column}>--</td>;
      })}
      {props.hasFillerColumn ? <td className={fileBrowserStyles.tableFillerCell} aria-hidden="true" /> : null}
    </tr>
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
    input.setSelectionRange(0, props.edit.value.length);
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
          props.edit.error && props.variant === "table" ? fileBrowserStyles.inlineFieldsInvalidTable : "",
        ].join(" ")}
      >
        <input
          className={fileBrowserStyles.inlineInput}
          ref={inputRef}
          aria-label={props.edit.kind === "create" ? "New item name" : "Rename item"}
          value={props.edit.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
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
        {props.edit.lockedExtension ? <span className={fileBrowserStyles.lockedExtension}>{props.edit.lockedExtension}</span> : null}
      </span>
      {props.edit.error ? (
        <span
          className={props.variant === "table"
            ? `${fileBrowserStyles.inlineError} ${fileBrowserStyles.inlineErrorTable}`
            : fileBrowserStyles.inlineError}
          title={props.edit.error}
        >
          {props.edit.error}
        </span>
      ) : null}
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
      {props.draft.lockedExtension ? <small className={fileBrowserStyles.passiveDraftExtension}>{props.draft.lockedExtension}</small> : null}
      <i className={fileBrowserStyles.passiveDraftCaret} aria-hidden="true" />
    </span>
  );
}
